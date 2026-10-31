import { Test, TestingModule } from '@nestjs/testing';
import { ValidateMasterKeyService } from './ValidateMasterKey.Service';
import { UnauthorizedException } from '@nestjs/common';

describe('ValidateMasterKeyService', () => {
  let service: ValidateMasterKeyService;
  const originalEnv = process.env;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidateMasterKeyService],
    }).compile();

    service = module.get<ValidateMasterKeyService>(ValidateMasterKeyService);
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateAuthorization', () => {
    it('should execute successfully when token is valid and not in dev mode', () => {
      process.env.MASTER_KEY = 'secret-key';
      process.env.NODE_ENV = 'prod';

      expect(() =>
        service.validateAuthorization('secret-key', false),
      ).not.toThrow();
    });

    it('should execute successfully when token is valid and in dev mode', () => {
      process.env.MASTER_KEY = 'secret-key';
      process.env.NODE_ENV = 'dev';

      expect(() =>
        service.validateAuthorization('secret-key', true),
      ).not.toThrow();
    });

    it('should execute successfully when token is valid, in dev mode, but not dev-only action', () => {
      process.env.MASTER_KEY = 'secret-key';
      process.env.NODE_ENV = 'dev';

      expect(() =>
        service.validateAuthorization('secret-key', false),
      ).not.toThrow();
    });

    it('should throw UnauthorizedException when token is invalid', () => {
      process.env.MASTER_KEY = 'secret-key';

      expect(() => service.validateAuthorization('wrong-key', false)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when in prod but trying to run dev-only action', () => {
      process.env.MASTER_KEY = 'secret-key';
      process.env.NODE_ENV = 'prod';

      expect(() => service.validateAuthorization('secret-key', true)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when token is invalid even in dev mode', () => {
      process.env.MASTER_KEY = 'secret-key';
      process.env.NODE_ENV = 'dev';

      expect(() => service.validateAuthorization('wrong-key', true)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
