from pathlib import Path
import unittest
from pipeline.scaffolder import NestJSScaffolder


class TestNestJSScaffolder(unittest.TestCase):
    def setUp(self):
        self.scaffolder = NestJSScaffolder()

    def test_parse_and_scaffold(self):
        service_code = """
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from 'model/user.entity';
import { MailerService } from 'modules/mailer.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly mailerService: MailerService,
  ) {}

  async createUser(email: string): Promise<UserEntity> {
    return this.userRepository.save({ email });
  }
}
"""
        service_path = Path("src/modules/user/user.service.ts")
        scaffold = self.scaffolder.generate_scaffold(service_path, service_code)

        # Assert correct imports
        self.assertIn("import { Test, TestingModule } from '@nestjs/testing';", scaffold)
        self.assertIn("import { getRepositoryToken } from '@nestjs/typeorm';", scaffold)
        self.assertIn("import { UserService } from './user.service';", scaffold)
        self.assertIn("import { UserEntity } from 'model/user.entity';", scaffold)
        self.assertIn("import { MailerService } from 'modules/mailer.service';", scaffold)

        # Assert mock declarations and provider tokens
        self.assertIn("let userRepository: any;", scaffold)
        self.assertIn("let mailerService: any;", scaffold)
        self.assertIn("provide: getRepositoryToken(UserEntity)", scaffold)
        self.assertIn("provide: MailerService", scaffold)

        # Assert clean, idiomatic mock helpers are structured in the scaffold
        self.assertIn("const createQueryBuilderMock = () => {", scaffold)
        self.assertIn("const createMockRepository = () => {", scaffold)
        self.assertIn("userRepository = createMockRepository();", scaffold)
        self.assertIn("softDelete: jest.fn()", scaffold)
        self.assertIn("save: jest.fn()", scaffold)

        # Assert baseline test and method describe block
        self.assertIn("it('should be defined'", scaffold)
        self.assertIn("describe('createUser'", scaffold)

    def test_extract_type_summary(self):
        from pipeline.scaffolder import extract_type_summary
        dto_code = """
export class ProfileInfoDto {
  name?: string;
  cpf: string;
  companyCNPJ: string;
  termsAccepted: boolean;

  constructor(cpf: string, companyCNPJ: string) {
    this.cpf = cpf;
    this.companyCNPJ = companyCNPJ;
  }
}
"""
        summary = extract_type_summary(dto_code)
        self.assertIn("export class ProfileInfoDto {", summary)
        self.assertIn("companyCNPJ: string;", summary)
        self.assertIn("termsAccepted: boolean;", summary)
        self.assertNotIn("this.companyCNPJ = companyCNPJ", summary)

    def test_scaffold_third_party_mocks(self):
        service_code = """
import { Injectable } from '@nestjs/common';
const Stripe = require('stripe');
const applicationStripe = Stripe(process.env.SSECRET);

@Injectable()
export class StripeService {}
"""
        scaffold = self.scaffolder.generate_scaffold(Path("Stripe.service.ts"), service_code)
        self.assertIn("jest.mock('stripe'", scaffold)
        self.assertIn("mockStripeAccounts", scaffold)


if __name__ == "__main__":
    unittest.main()
