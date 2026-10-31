const mockAccounts = {
  listPersons: jest.fn(),
  update: jest.fn(),
  updatePerson: jest.fn(),
  del: jest.fn(),
  retrieve: jest.fn(),
  create: jest.fn(),
  createExternalAccount: jest.fn(),
  createPerson: jest.fn(),
};

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    accounts: mockAccounts,
  }));
});

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { StripeCreateConnectedAccountService } from './StripeCreateConnectedAccount.service';
import { StripeFilesService } from './StripeFiles.service';
import { StrypeAccountTypeEnum } from 'enums/StrypeAccountTypeEnum';

describe('StripeCreateConnectedAccountService', () => {
  let service: StripeCreateConnectedAccountService;
  let stripeFilesService: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    stripeFilesService = {
      createFile: jest.fn().mockResolvedValue({ id: 'file_mock_123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeCreateConnectedAccountService,
        {
          provide: StripeFilesService,
          useValue: stripeFilesService,
        },
      ],
    }).compile();

    service = module.get<StripeCreateConnectedAccountService>(
      StripeCreateConnectedAccountService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buscarPessoasDaEmpresa', () => {
    it('should return mapped persons when stripe returns data', async () => {
      mockAccounts.listPersons.mockResolvedValueOnce({
        data: [
          {
            id: 'person_1',
            first_name: 'John',
            last_name: 'Doe',
            verification: {
              status: 'verified',
              document: { front: 'f1', back: 'b1' },
            },
            requirements: { currently_due: ['verification.document'] },
          },
        ],
      });

      const result = await service.buscarPessoasDaEmpresa('acct_123');

      expect(result).toEqual([
        {
          id: 'person_1',
          firstName: 'John Doe',
          status: 'verified',
          documentsSent: true,
          documentsNeeded: true,
        },
      ]);
    });

    it('should return null if stripe response has no data', async () => {
      mockAccounts.listPersons.mockResolvedValueOnce(null);

      const result = await service.buscarPessoasDaEmpresa('acct_123');
      expect(result).toBeNull();
    });

    it('should throw InternalServerErrorException on error', async () => {
      mockAccounts.listPersons.mockRejectedValueOnce(new Error('Stripe API error'));

      await expect(service.buscarPessoasDaEmpresa('acct_123')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('atualizarDocumentosCompany', () => {
    it('should upload files and update account when companyDocuments.identity has items', async () => {
      const companyDocs = {
        identity: [Buffer.from('doc1'), Buffer.from('doc2')],
      } as any;

      await service.atualizarDocumentosCompany('acct_123', companyDocs);

      expect(stripeFilesService.createFile).toHaveBeenCalledTimes(2);
      expect(mockAccounts.update).toHaveBeenCalledWith('acct_123', {
        company: {
          verification: {
            document: {
              front: 'file_mock_123',
            },
          },
        },
      });
    });

    it('should throw InternalServerErrorException on error', async () => {
      stripeFilesService.createFile.mockRejectedValueOnce(new Error('File upload fail'));

      await expect(
        service.atualizarDocumentosCompany('acct_123', { identity: [Buffer.from('d')] } as any),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('atualizarDocumentosPersonCompany', () => {
    it('should upload front and back and updatePerson', async () => {
      await service.atualizarDocumentosPersonCompany('acct_123', 'person_1', {
        front: Buffer.from('front'),
        back: Buffer.from('back'),
      } as any);

      expect(stripeFilesService.createFile).toHaveBeenCalledTimes(2);
      expect(mockAccounts.updatePerson).toHaveBeenCalledWith('acct_123', 'person_1', {
        verification: {
          document: {
            front: 'file_mock_123',
            back: 'file_mock_123',
          },
        },
      });
    });

    it('should throw InternalServerErrorException when update fails', async () => {
      mockAccounts.updatePerson.mockRejectedValueOnce(new Error('Update error'));

      await expect(
        service.atualizarDocumentosPersonCompany('acct_123', 'person_1', {
          front: Buffer.from('front'),
          back: Buffer.from('back'),
        } as any),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('atualizarDocumentosPessoais', () => {
    it('should throw InternalServerErrorException if front or back is missing', async () => {
      await expect(
        service.atualizarDocumentosPessoais('acct_123', {} as any),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should upload individual documents and update account', async () => {
      await service.atualizarDocumentosPessoais('acct_123', {
        front: Buffer.from('f'),
        back: Buffer.from('b'),
      } as any);

      expect(mockAccounts.update).toHaveBeenCalledWith('acct_123', {
        individual: {
          verification: {
            document: {
              front: 'file_mock_123',
              back: 'file_mock_123',
            },
          },
        },
      });
    });
  });

  describe('atualizarDadosIndividuais', () => {
    it('should update individual account data', async () => {
      const mockDto = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '11999999999',
        dateOfBirth: new Date('1995-05-15'),
        cpf: '12345678901',
        address: {
          city: 'Sao Paulo',
          address: 'Rua A',
          complemento: 'Apto 1',
          cep: '01001-000',
          state: 'SP',
        },
      } as any;

      mockAccounts.update.mockResolvedValueOnce({ id: 'acct_123' });

      const result = await service.atualizarDadosIndividuais('acct_123', mockDto);

      expect(result).toEqual({ id: 'acct_123' });
      expect(mockAccounts.update).toHaveBeenCalledWith(
        'acct_123',
        expect.objectContaining({
          individual: expect.objectContaining({
            first_name: 'Jane',
            last_name: 'Doe',
            phone: '+5511999999999',
            id_number: '12345678901',
          }),
        }),
      );
    });
  });

  describe('account management methods', () => {
    it('should delete connected account', async () => {
      mockAccounts.del.mockResolvedValueOnce({ deleted: true });
      await service.deleteConnectedAccount('acct_123');
      expect(mockAccounts.del).toHaveBeenCalledWith('acct_123');
    });

    it('should retrieve connected account', async () => {
      mockAccounts.retrieve.mockResolvedValueOnce({ id: 'acct_123' });
      const res = await service.retrieveConnectedAccount('acct_123');
      expect(res).toEqual({ id: 'acct_123' });
      expect(mockAccounts.retrieve).toHaveBeenCalledWith('acct_123');
    });

    it('should update connected account', async () => {
      mockAccounts.update.mockResolvedValueOnce({ id: 'acct_123' });
      const res = await service.updateConnectedAccount('acct_123', { metadata: { key: 'val' } });
      expect(res).toEqual({ id: 'acct_123' });
    });
  });

  describe('getAccountStatus', () => {
    it('should return rejected when disabled_reason contains rejected', async () => {
      const res = await service.getAccountStatus({
        requirements: { disabled_reason: 'rejected.fraud' },
      });
      expect(res).toBe('rejected');
    });

    it('should return complete when enabled and no due requirements', async () => {
      const res = await service.getAccountStatus({
        payouts_enabled: true,
        charges_enabled: true,
        requirements: { disabled_reason: null, currently_due: null, eventually_due: null },
      });
      expect(res).toBe('complete');
    });

    it('should return restricted (payouts disabled) when only charges enabled', async () => {
      const res = await service.getAccountStatus({
        payouts_enabled: false,
        charges_enabled: true,
        requirements: {},
      });
      expect(res).toBe('restricted (payouts disabled)');
    });

    it('should return restricted (charges disabled) when only payouts enabled', async () => {
      const res = await service.getAccountStatus({
        payouts_enabled: true,
        charges_enabled: false,
        requirements: {},
      });
      expect(res).toBe('restricted (charges disabled)');
    });

    it('should return restricted (past due) when requirements past due', async () => {
      const res = await service.getAccountStatus({
        payouts_enabled: false,
        charges_enabled: false,
        requirements: { past_due: ['id'] },
      });
      expect(res).toBe('restricted (past due)');
    });
  });

  describe('createConnectedAccount', () => {
    it('should create individual stripe account', async () => {
      mockAccounts.create.mockResolvedValueOnce({ id: 'acct_new' });

      const input = {
        type: StrypeAccountTypeEnum.INDIVIDUAL,
        stripeTermsIp: '127.0.0.1',
        externalAccount: {
          accountNumber: '12345',
          bank: { code: '1' },
          agency: '0001',
          accountHolderName: 'John',
        },
        individualData: {
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: new Date('1990-01-01'),
          address: { address: 'Rua', number: '1', complemento: 'C', cep: '01001-000', city: 'SP', state: 'SP' },
          email: 'john@example.com',
          phone: '+5511999999999',
          politicalExposure: false,
          cpf: '12345678909',
        },
      } as any;

      const res = await service.createConnectedAccount('john@example.com', 'user-1', input);

      expect(res).toEqual({ id: 'acct_new' });
      expect(mockAccounts.create).toHaveBeenCalled();
    });
  });

  describe('createBankAccount and createPerson', () => {
    it('should call createExternalAccount', async () => {
      await service.createBankAccount('acct_123', '123', '001', 'BR', 'BRL', 'John', true);
      expect(mockAccounts.createExternalAccount).toHaveBeenCalledWith('acct_123', expect.any(Object));
    });

    it('should call createPerson', async () => {
      const clientInfo = {
        firstName: 'John',
        lastName: 'Doe',
        address: { address: 'Rua', number: '1', complemento: 'C', cep: '01001-000', city: 'SP', state: 'SP' },
        dateOfBirth: new Date('1990-01-01'),
        email: 'john@example.com',
        cpf: '12345678909',
        phone: '11999999999',
        politicalExposure: true,
        relationship: {
          director: true,
          executive: false,
          owner: true,
          percentOwnership: 50,
          representative: true,
          title: 'CEO',
        },
      } as any;

      mockAccounts.createPerson.mockResolvedValueOnce({ id: 'person_new' });

      const res = await service.createPerson('acct_123', clientInfo);
      expect(res).toEqual({ id: 'person_new' });
      expect(mockAccounts.createPerson).toHaveBeenCalledWith('acct_123', expect.any(Object));
    });
  });

  describe('fixPhone', () => {
    it('should keep +55 if already present', () => {
      expect(service.fixPhone('+5511999999999')).toBe('+5511999999999');
    });

    it('should prepend +55 if missing', () => {
      expect(service.fixPhone('11999999999')).toBe('+5511999999999');
    });
  });
});
