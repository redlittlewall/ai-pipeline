import json
from pathlib import Path
import tempfile
import unittest

from pipeline.worker import (
    extract_class_body,
    extract_entity_schema_from_service,
    find_entity_file,
    format_entity_schema_block,
    identify_failed_entities,
    is_repository_or_type_error,
    parse_typeorm_entity,
)


class TestTypeORMSchemaExtractor(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_dir.name)
        self.src_dir = self.project_path / "src"
        self.modules_dir = self.src_dir / "modules" / "address"
        self.entities_dir = self.modules_dir / "entities"
        self.entities_dir.mkdir(parents=True, exist_ok=True)

        # 1. Create ArtistLocatesInAddress.entity.ts
        self.entity_file = self.entities_dir / "ArtistLocatesInAddress.entity.ts"
        self.entity_code = """
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Artist } from './Artist.entity';
import { Address } from './Address.entity';

@Entity('artist_locates_in_address')
export class ArtistLocatesInAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  complement?: string;

  @ManyToOne(() => Artist, (artist) => artist.locations)
  @JoinColumn({ name: 'artist_id' })
  artist: Artist;

  @ManyToOne(() => Address)
  @JoinColumn({ name: 'address_id' })
  address: Address;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  constructor(init?: Partial<ArtistLocatesInAddress>) {
    Object.assign(this, init);
  }

  get isComplete(): boolean {
    return Boolean(this.artist && this.address);
  }
}
"""
        self.entity_file.write_text(self.entity_code, encoding="utf-8")

        # 2. Create Address.entity.ts
        self.address_entity_file = self.entities_dir / "Address.entity.ts"
        self.address_entity_code = """
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('addresses')
export class Address {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  street: string;

  @Column()
  city: string;
}
"""
        self.address_entity_file.write_text(self.address_entity_code, encoding="utf-8")

        # 3. Create SetArtistLocale.service.ts
        self.service_file = self.modules_dir / "SetArtistLocale.service.ts"
        self.service_code = """
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArtistLocatesInAddress } from './entities/ArtistLocatesInAddress.entity';
import { Address } from './entities/Address.entity';

@Injectable()
export class SetArtistLocaleService {
  constructor(
    @InjectRepository(ArtistLocatesInAddress)
    private readonly artistLocatesInAdressesRepository: Repository<ArtistLocatesInAddress>,
    @InjectRepository(Address)
    private readonly addressRepository: Repository<Address>,
  ) {}

  async changeArtistLocation(artist: any) {
    await this.artistLocatesInAdressesRepository.softDelete({
      artist: { id: artist.id },
    });
  }
}
"""
        self.service_file.write_text(self.service_code, encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_is_repository_or_type_error(self):
        """Valida a detecção de erros de tipos TypeScript, TypeErrors e métodos ausentes de repositório."""
        # TS compiler errors
        self.assertTrue(
            is_repository_or_type_error(
                "error TS2345: Argument of type 'string' is not assignable to parameter of type 'Client'."
            )
        )
        self.assertTrue(
            is_repository_or_type_error(
                "error TS2339: Property 'softDelete' does not exist on type 'Repository<ArtistLocatesInAddress>'."
            )
        )
        self.assertTrue(
            is_repository_or_type_error(
                "error TS2352: Conversion of type 'object' to type 'Artist' may be a mistake."
            )
        )

        # Jest runtime TypeErrors
        self.assertTrue(
            is_repository_or_type_error(
                "TypeError: this.artistLocatesInAdressesRepository.softDelete is not a function"
            )
        )
        self.assertTrue(
            is_repository_or_type_error(
                "TypeError: Cannot read properties of undefined (reading 'findOne')"
            )
        )

        # TypeORM query builder & methods
        self.assertTrue(is_repository_or_type_error("Error: repository.findAndCount failed"))
        self.assertTrue(
            is_repository_or_type_error("Error: createQueryBuilder(...).where is not a function")
        )

        # Unrelated errors
        self.assertFalse(is_repository_or_type_error("SyntaxError: Unexpected token '}'"))
        self.assertFalse(is_repository_or_type_error("Error: Cannot find module '@unknown/lib'"))
        self.assertFalse(is_repository_or_type_error(""))

    def test_identify_failed_entities(self):
        """Valida a identificação precisa das entidades a partir do repositório ou erro informado."""
        # Erro mencionando repositório injetado 'artistLocatesInAdressesRepository'
        err1 = "TypeError: this.artistLocatesInAdressesRepository.softDelete is not a function"
        entities1 = identify_failed_entities(err1, self.service_code)
        self.assertEqual(entities1, ["ArtistLocatesInAddress"])

        # Erro TypeScript mencionando entidade 'Address'
        err2 = "src/test.spec.ts:40:15 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'Address'."
        entities2 = identify_failed_entities(err2, self.service_code)
        self.assertEqual(entities2, ["Address"])

        # Erro genérico de repositório no Jest sem nome explícito de variável
        err3 = "TypeError: Cannot read properties of undefined (reading 'findOne')"
        entities3 = identify_failed_entities(err3, self.service_code)
        self.assertEqual(entities3, ["ArtistLocatesInAddress", "Address"])

        # Sem erro (chamada limpa): retorna todas as entidades injetadas no construtor
        entities_all = identify_failed_entities("", self.service_code)
        self.assertEqual(entities_all, ["ArtistLocatesInAddress", "Address"])

    def test_find_entity_file(self):
        """Valida a localização estática do arquivo *.entity.ts a partir de imports ou busca no projeto."""
        # Resolução via import relativo do service
        found = find_entity_file(
            self.project_path,
            "ArtistLocatesInAddress",
            service_code=self.service_code,
            service_path=self.service_file,
        )
        self.assertIsNotNone(found)
        self.assertEqual(found, self.entity_file.resolve())

        # Resolução via busca global no projeto (sem service_code)
        found_address = find_entity_file(self.project_path, "Address")
        self.assertIsNotNone(found_address)
        self.assertEqual(found_address, self.address_entity_file.resolve())

        # Entidade inexistente
        not_found = find_entity_file(self.project_path, "NonExistentEntity")
        self.assertIsNone(not_found)

    def test_parse_typeorm_entity(self):
        """Valida a extração de colunas, tipos e relacionamentos de arquivo de entidade TypeORM."""
        parsed = parse_typeorm_entity(self.entity_file, "ArtistLocatesInAddress")
        self.assertEqual(parsed["class_name"], "ArtistLocatesInAddress")

        fields = parsed["fields"]
        field_dict = {f["name"]: f for f in fields}

        # Verifica colunas normais e primárias
        self.assertIn("id", field_dict)
        self.assertEqual(field_dict["id"]["type"], "string")
        self.assertFalse(field_dict["id"]["is_relation"])

        self.assertIn("createdAt", field_dict)
        self.assertEqual(field_dict["createdAt"]["type"], "Date")
        self.assertFalse(field_dict["createdAt"]["is_relation"])

        # Verifica relacionamentos ManyToOne
        self.assertIn("artist", field_dict)
        self.assertEqual(field_dict["artist"]["type"], "Artist")
        self.assertTrue(field_dict["artist"]["is_relation"])

        self.assertIn("address", field_dict)
        self.assertEqual(field_dict["address"]["type"], "Address")
        self.assertTrue(field_dict["address"]["is_relation"])

        # Verifica que métodos e construtor não foram extraídos como campos
        field_names = [f["name"] for f in fields]
        self.assertNotIn("constructor", field_names)
        self.assertNotIn("isComplete", field_names)

    def test_format_entity_schema_block(self):
        """Valida a formatação exata do bloco de schema injetado conforme a especificação."""
        fields = [
            {"name": "id", "type": "string", "is_relation": False},
            {"name": "artist", "type": "Artist", "is_relation": True},
            {"name": "address", "type": "Address", "is_relation": True},
            {"name": "createdAt", "type": "Date", "is_relation": False},
        ]
        block = format_entity_schema_block(
            "src/modules/address/entities/ArtistLocatesInAddress.entity.ts", fields
        )

        expected = (
            "[CONTEXTO DE ENTIDADE INJETADO DEVIDO A ERRO NO JEST]\n"
            "Arquivo: src/modules/address/entities/ArtistLocatesInAddress.entity.ts\n"
            "Estrutura da Entidade:\n"
            "- id: string\n"
            "- artist: Artist (relation)\n"
            "- address: Address (relation)\n"
            "- createdAt: Date"
        )
        self.assertEqual(block, expected)

    def test_extract_entity_schema_from_service_end_to_end(self):
        """Valida o fluxo ponta a ponta de extração de schema guiado por erro do Jest."""
        jest_error = """
TypeError: this.artistLocatesInAdressesRepository.softDelete is not a function

      35 |     if (artist.id) {
      36 |
    > 37 |       await this.artistLocatesInAdressesRepository.softDelete({
         |                                                    ^
      38 |         artist: { id: artist.id },
      39 |       });
      40 |     }

      at SetArtistLocaleService.changeArtistLocation (src/modules/address/SetArtistLocale.service.ts:37:52)
      at Object.<anonymous> (src/modules/address/SetArtistLocale.service.spec.ts:143:22)
"""
        schema_context = extract_entity_schema_from_service(
            project_path=self.project_path,
            service_file="src/modules/address/SetArtistLocale.service.ts",
            error_text=jest_error,
        )

        self.assertIn("[CONTEXTO DE ENTIDADE INJETADO DEVIDO A ERRO NO JEST]", schema_context)
        self.assertIn(
            "Arquivo: src/modules/address/entities/ArtistLocatesInAddress.entity.ts", schema_context
        )
        self.assertIn("Estrutura da Entidade:", schema_context)
        self.assertIn("- id: string", schema_context)
        self.assertIn("- artist: Artist (relation)", schema_context)
        self.assertIn("- address: Address (relation)", schema_context)
        self.assertIn("- createdAt: Date", schema_context)

        # Não deve injetar Address quando o erro foi específico do repositório artistLocatesInAdressesRepository
        self.assertNotIn("Arquivo: src/modules/address/entities/Address.entity.ts", schema_context)

    def test_extract_entity_schema_ignores_unrelated_errors(self):
        """Valida que erros não relacionados a repositórios/tipos retornam string vazia sem poluir o prompt."""
        syntax_error = "SyntaxError: Unexpected token '}' at src/test.spec.ts:12:4"
        res = extract_entity_schema_from_service(
            project_path=self.project_path,
            service_file="src/modules/address/SetArtistLocale.service.ts",
            error_text=syntax_error,
        )
        self.assertEqual(res, "")


if __name__ == "__main__":
    unittest.main()
