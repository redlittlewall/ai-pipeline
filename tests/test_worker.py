from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import (
    TaskWorker,
    check_anti_sut_mocking,
    get_file_hash,
    parse_line_coverage,
    sanitize_mock_types,
)


class TestTaskWorker(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_dir.name)
        self.queue_file = self.project_path / "queue.json"
        self.qm = QueueManager(self.queue_file)

        # Create dummy service file
        self.src_dir = self.project_path / "src" / "modules" / "test"
        self.src_dir.mkdir(parents=True, exist_ok=True)
        self.service_file = self.src_dir / "Test.service.ts"
        self.service_file.write_text("export class TestService {}", encoding="utf-8")

        self.spec_file = self.src_dir / "Test.service.spec.ts"
        self.worker = TaskWorker(min_line_coverage=50.0)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_file_hash(self):
        hash1 = get_file_hash(self.service_file)
        self.assertTrue(len(hash1) == 64)

        self.service_file.write_text("modified", encoding="utf-8")
        hash2 = get_file_hash(self.service_file)
        self.assertNotEqual(hash1, hash2)

    def test_anti_sut_mocking_detection(self):
        bad_spec_1 = "jest.spyOn(service, 'reclassify').mockResolvedValue({});"
        self.assertIsNotNone(check_anti_sut_mocking(bad_spec_1))

        bad_spec_2 = "jest.spyOn(sut, 'calculate').mockReturnValue(10);"
        self.assertIsNotNone(check_anti_sut_mocking(bad_spec_2))

        bad_spec_3 = "service.save = jest.fn();"
        self.assertIsNotNone(check_anti_sut_mocking(bad_spec_3))

        good_spec = "expect(repository.findOne).toHaveBeenCalledWith({ id: '1' });"
        self.assertIsNone(check_anti_sut_mocking(good_spec))

    def test_parse_line_coverage(self):
        stdout = (
            "-------------------|---------|----------|---------|---------|-------------------\n"
            "File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s \n"
            "-------------------|---------|----------|---------|---------|-------------------\n"
            " ...too.service.ts |   45.94 |        0 |   33.33 |   84.50 | 31-95             \n"
            "-------------------|---------|----------|---------|---------|-------------------\n"
        )
        cov = parse_line_coverage(stdout, "AdminAiClassifyTattoo.service.ts")
        self.assertEqual(cov, 84.50)

    @patch.object(TaskWorker, "run_command")
    def test_execute_task_success(self, mock_run_command):
        coverage_output = (
            "PASS test\n"
            "File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s\n"
            "Test.service.ts | 80.0 | 50.0 | 80.0 | 75.0 | 10-12\n"
        )

        def fake_run_command(cmd, cwd=None, timeout=None):
            if any("aider" in str(arg) for arg in cmd):
                self.spec_file.write_text(
                    "describe('TestService', () => {\n"
                    "  it('should work', () => { expect(true).toBe(true); });\n"
                    "  it('should error', () => { expect(false).toBe(false); });\n"
                    "});",
                    encoding="utf-8",
                )
                return (0, "Aider success", "")
            elif any("prettier" in str(arg) for arg in cmd):
                return (0, "Prettier success", "")
            elif any("jest" in str(arg) for arg in cmd):
                return (0, coverage_output, "")
            elif any("git" in str(arg) for arg in cmd):
                return (0, "", "")
            return (0, "", "")

        mock_run_command.side_effect = fake_run_command

        task = Task(
            id="TASK-TEST-001",
            project_path=str(self.project_path),
            service_file="src/modules/test/Test.service.ts",
            spec_file="src/modules/test/Test.service.spec.ts",
            module_name="test",
            profile="nestjs",
        )
        self.qm.save_queue([task])

        success = self.worker.execute_task(task, self.qm)
        self.assertTrue(success)

        updated_task = self.qm.load_queue()[0]
        self.assertEqual(updated_task.status, "completed")

    @patch.object(TaskWorker, "run_command")
    def test_dynamic_schema_injection_on_jest_error(self, mock_run_command):
        """Valida que falha no Jest por método de repositório ausente injeta o schema da entidade no prompt da tentativa seguinte."""
        entities_dir = self.src_dir / "entities"
        entities_dir.mkdir(parents=True, exist_ok=True)
        entity_file = entities_dir / "ArtistLocatesInAddress.entity.ts"
        entity_file.write_text(
            """
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn } from 'typeorm';
import { Artist } from './Artist.entity';
import { Address } from './Address.entity';

@Entity('artist_locates_in_address')
export class ArtistLocatesInAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Artist, (artist) => artist.locations)
  @JoinColumn({ name: 'artist_id' })
  artist: Artist;

  @ManyToOne(() => Address)
  @JoinColumn({ name: 'address_id' })
  address: Address;

  @CreateDateColumn()
  createdAt: Date;
}
""",
            encoding="utf-8",
        )

        service_file = self.src_dir / "SetArtistLocale.service.ts"
        service_file.write_text(
            """
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArtistLocatesInAddress } from './entities/ArtistLocatesInAddress.entity';

@Injectable()
export class SetArtistLocaleService {
  constructor(
    @InjectRepository(ArtistLocatesInAddress)
    private readonly artistLocatesInAdressesRepository: Repository<ArtistLocatesInAddress>,
  ) {}

  async changeArtistLocation(artist: any) {
    await this.artistLocatesInAdressesRepository.softDelete({ artist: { id: artist.id } });
  }
}
""",
            encoding="utf-8",
        )

        spec_file = self.src_dir / "SetArtistLocale.service.spec.ts"
        spec_file.write_text("// initial scaffold\n", encoding="utf-8")

        captured_aider_prompts = []
        attempt_counter = {"jest": 0}

        def fake_run_command(cmd, cwd=None, timeout=None):
            cmd_str = " ".join(str(c) for c in cmd)
            if "aider" in cmd_str:
                # Capture prompt message argument
                if "--message" in cmd:
                    msg_idx = cmd.index("--message") + 1
                    captured_aider_prompts.append(cmd[msg_idx])
                # Simulate Aider editing the spec
                spec_file.write_text(
                    "describe('SetArtistLocaleService', () => {\n"
                    "  it('should change location', async () => { expect(true).toBe(true); });\n"
                    "  it('should handle errors', async () => { expect(false).toBe(false); });\n"
                    "});",
                    encoding="utf-8",
                )
                return (0, "Aider modified spec", "")
            elif "prettier" in cmd_str:
                return (0, "Prettier formatted", "")
            elif "jest" in cmd_str:
                attempt_counter["jest"] += 1
                if attempt_counter["jest"] == 1:
                    # Attempt 1: Jest fails with missing softDelete method on mock repository
                    error_output = (
                        "FAIL src/modules/test/SetArtistLocale.service.spec.ts\n"
                        "● SetArtistLocaleService › changeArtistLocation › should change location\n\n"
                        "  TypeError: this.artistLocatesInAdressesRepository.softDelete is not a function\n\n"
                        "    35 |     if (artist.id) {\n"
                        "  > 37 |       await this.artistLocatesInAdressesRepository.softDelete({\n"
                        "       |                                                    ^\n"
                        "        at SetArtistLocaleService.changeArtistLocation (src/modules/test/SetArtistLocale.service.ts:37:52)\n"
                    )
                    return (1, "", error_output)
                else:
                    # Attempt 2: Jest passes with high coverage after schema injection
                    coverage_output = (
                        "PASS src/modules/test/SetArtistLocale.service.spec.ts\n"
                        "File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s\n"
                        "SetArtistLocale.service.ts | 85.0 | 60.0 | 80.0 | 85.0 | \n"
                    )
                    return (0, coverage_output, "")
            elif "git" in cmd_str:
                return (0, "", "")
            return (0, "", "")

        mock_run_command.side_effect = fake_run_command

        task = Task(
            id="TASK-SCHEMA-TEST",
            project_path=str(self.project_path),
            service_file="src/modules/test/SetArtistLocale.service.ts",
            spec_file="src/modules/test/SetArtistLocale.service.spec.ts",
            module_name="test",
            profile="nestjs",
            max_attempts=3,
        )
        self.qm.save_queue([task])

        success = self.worker.execute_task(task, self.qm)
        self.assertTrue(success)

        # Deve ter executado pelo menos 2 chamadas ao Aider
        self.assertGreaterEqual(len(captured_aider_prompts), 2)

        # O prompt da 2ª tentativa DEVE conter o bloco de schema da entidade TypeORM injetado
        prompt_attempt_2 = captured_aider_prompts[1]
        self.assertIn("[CONTEXTO DE ENTIDADE INJETADO DEVIDO A ERRO NO JEST]", prompt_attempt_2)
        self.assertIn(
            "Arquivo: src/modules/test/entities/ArtistLocatesInAddress.entity.ts", prompt_attempt_2
        )
        self.assertIn("Estrutura da Entidade:", prompt_attempt_2)
        self.assertIn("- id: string", prompt_attempt_2)
        self.assertIn("- artist: Artist (relation)", prompt_attempt_2)
        self.assertIn("- address: Address (relation)", prompt_attempt_2)
        self.assertIn("- createdAt: Date", prompt_attempt_2)

        # Task deve estar completada com sucesso
        updated = self.qm.load_queue()[0]
        self.assertEqual(updated.status, "completed")

    def test_sanitize_mock_types_does_not_monkey_patch_runtime_mocks(self):
        """Valida que o worker purga substituições frágeis de regex (Ticket 03), confiando no scaffold determinístico e Jest."""
        raw_spec = (
            "import { User } from 'src/modules/user/user.entity';\n\n"
            "describe('UserService', () => {\n"
            "  let repo = {\n"
            "    save: jest.fn(),\n"
            "    delete: jest.fn(),\n"
            "  };\n"
            "  it('should test whereFactory', () => {\n"
            "    whereFactory(qb);\n"
            "  });\n"
            "});\n"
        )

        cleaned = sanitize_mock_types(raw_spec)

        # 1. Normaliza prefixo 'src/' em imports
        self.assertIn("import { User } from 'modules/user/user.entity';", cleaned)

        # 2. NÃO deve monkey-patchar regexes frágeis em runtime:
        # save não deve ser alterado com mockImplementation arbitrário
        self.assertIn("save: jest.fn(),", cleaned)
        # softDelete não deve ser injetado via regex artesanal
        self.assertNotIn("softDelete:", cleaned)
        # whereFactory não deve receber casting arbitrário via regex
        self.assertIn("whereFactory(qb);", cleaned)
        self.assertNotIn("whereFactory(qb as any)", cleaned)

        # 3. Fecha bloco describe se o arquivo foi truncado pela metade
        truncated_spec = (
            "describe('UserService', () => {\n"
            "  it('test 1', () => {\n"
            "    expect(1).toBe(1);\n"
            "  });\n"
            "  it('incomplete test', () => {\n"
            "    expect(2)"
        )
        healed = sanitize_mock_types(truncated_spec)
        self.assertTrue(healed.endswith("});\n"))


if __name__ == "__main__":
    unittest.main()
