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

        # Assert baseline test and method describe block
        self.assertIn("it('should be defined'", scaffold)
        self.assertIn("describe('createUser'", scaffold)


if __name__ == "__main__":
    unittest.main()
