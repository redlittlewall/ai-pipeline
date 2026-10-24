import unittest
from pathlib import Path

from pipeline.golden_set import (
    GOLDEN_SET,
    GoldenSetItem,
    create_golden_tasks,
    get_golden_set,
    get_golden_set_by_complexity,
)


class TestGoldenSet(unittest.TestCase):
    def test_golden_set_size_and_composition(self):
        """Verifica que o Golden Set possui exatamente 10 serviços divididos em 3 baixa, 4 média e 3 alta complexidade."""
        items = get_golden_set()
        self.assertEqual(len(items), 10)

        low = get_golden_set_by_complexity("low")
        medium = get_golden_set_by_complexity("medium")
        high = get_golden_set_by_complexity("high")

        self.assertEqual(len(low), 3, "Devem existir exatamente 3 serviços de baixa complexidade")
        self.assertEqual(len(medium), 4, "Devem existir exatamente 4 serviços de média complexidade")
        self.assertEqual(len(high), 3, "Devem existir exatamente 3 serviços de alta complexidade com TypeORM")

    def test_golden_set_items_integrity(self):
        """Valida que todos os serviços têm caminhos de arquivo válidos, módulo e descrição não-vazios."""
        seen_ids = set()
        seen_services = set()

        for item in GOLDEN_SET:
            self.assertIsInstance(item, GoldenSetItem)
            self.assertNotIn(item.id, seen_ids, f"ID duplicado encontrado: {item.id}")
            seen_ids.add(item.id)

            self.assertNotIn(item.service_file, seen_services, f"Serviço duplicado: {item.service_file}")
            seen_services.add(item.service_file)

            self.assertTrue(
                item.service_file.endswith(".service.ts") or item.service_file.endswith(".Service.ts"),
                f"Extensão inválida para service_file: {item.service_file}",
            )
            self.assertTrue(
                item.spec_file.endswith(".service.spec.ts") or item.spec_file.endswith(".Service.spec.ts"),
                f"Extensão inválida para spec_file: {item.spec_file}",
            )
            self.assertIn(item.complexity, ["low", "medium", "high"])
            self.assertTrue(len(item.description) > 10, f"Descrição muito curta para {item.service_file}")
            self.assertTrue(len(item.module_name) > 0, f"Módulo vazio para {item.service_file}")

    def test_create_golden_tasks(self):
        """Valida a conversão do Golden Set para a fila isolada de tasks."""
        dummy_path = "/tmp/dummy-tattoopop-api"
        tasks = create_golden_tasks(dummy_path, max_attempts=3)

        self.assertEqual(len(tasks), 10)
        for task in tasks:
            self.assertEqual(task.project_path, dummy_path)
            self.assertEqual(task.status, "pending")
            self.assertEqual(task.attempts, 0)
            self.assertEqual(task.max_attempts, 3)
            self.assertEqual(task.profile, "nestjs")
            self.assertIsNone(task.error_log)


if __name__ == "__main__":
    unittest.main()
