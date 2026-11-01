import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateStriepeAccountService } from './CreateStriepeAccount.service';
import { Artist } from 'model/users/Artist.entity';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';
import { StripeCreateConnectedAccountService } from '../stripe/StripeCreateConnectedAccount.service';
import { SaveStripeAccountDataService } from '../stripe/SaveStripeAccountData.Service';
import { BadRequestException } from '@nestjs/common';
import { StrypeAccountTypeEnum } from 'enums/StrypeAccountTypeEnum';

describe('CreateStriepeAccountService', () => {
  let service: CreateStriepeAccountService;
  let artistRepository: any;
  let stripeAccountRepository: any;
  let stripeCreateConnectedAccountService: any;
  let saveStripeAccountDataService: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    artistRepository = createMockRepository();
    stripeAccountRepository = createMockRepository();
    stripeCreateConnectedAccountService = {
      atualizarDocumentosCompany: jest.fn(),
      atualizarDocumentosPessoais: jest.fn(),
      createConnectedAccount: jest.fn(),
      createPerson: jest.fn(),
      deleteConnectedAccount: jest.fn(),
      retrieveConnectedAccount: jest.fn(),
      updateConnectedAccount: jest.fn(),
    };
    saveStripeAccountDataService = {
      handle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateStriepeAccountService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(StripeAccountEntity),
          useValue: stripeAccountRepository,
        },
        {
          provide: StripeCreateConnectedAccountService,
          useValue: stripeCreateConnectedAccountService,
        },
        {
          provide: SaveStripeAccountDataService,
          useValue: saveStripeAccountDataService,
        },
      ],
    }).compile();

    service = module.get<CreateStriepeAccountService>(
      CreateStriepeAccountService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('atualizarDocumentosCompany', () => {
    it('should execute atualizarDocumentosCompany successfully', async () => {
      artistRepository.findOne.mockResolvedValue({
        stripeAccount: { id: 'stripe-id' },
      } as any);

      await service.atualizarDocumentosCompany('user-id', {} as any);

      expect(
        stripeCreateConnectedAccountService.atualizarDocumentosCompany,
      ).toHaveBeenCalledWith('stripe-id', {});
      expect(stripeAccountRepository.update).toHaveBeenCalledWith(
        { id: 'stripe-id' },
        { documentsSent: true },
      );
    });

    it('should throw BadRequestException if stripe account is null', async () => {
      artistRepository.findOne.mockResolvedValue({
        stripeAccount: null,
      } as any);

      await expect(
        service.atualizarDocumentosCompany('user-id', {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('atualizarDocumentosPessoais', () => {
    it('should execute atualizarDocumentosPessoais successfully', async () => {
      artistRepository.findOne.mockResolvedValue({
        stripeAccount: { id: 'stripe-id' },
      } as any);

      await service.atualizarDocumentosPessoais('user-id', {} as any);

      expect(
        stripeCreateConnectedAccountService.atualizarDocumentosPessoais,
      ).toHaveBeenCalledWith('stripe-id', {});
      expect(stripeAccountRepository.update).toHaveBeenCalledWith(
        { id: 'stripe-id' },
        { documentsSent: true },
      );
    });

    it('should throw BadRequestException if stripe account is null', async () => {
      artistRepository.findOne.mockResolvedValue({
        stripeAccount: null,
      } as any);

      await expect(
        service.atualizarDocumentosPessoais('user-id', {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handle', () => {
    it('should create individual stripe account successfully', async () => {
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        stripeAccount: null,
      } as any);
      stripeCreateConnectedAccountService.createConnectedAccount.mockResolvedValue(
        {
          id: 'stripe-id',
          external_accounts: { data: [{ id: 'ext-id' }] },
        } as any,
      );
      saveStripeAccountDataService.handle.mockResolvedValue({
        id: 'sa-id',
      } as any);

      const dto = {
        type: StrypeAccountTypeEnum.INDIVIDUAL,
        individualData: { email: 'test@test.com' },
      } as any;

      const result = await service.handle('artist-id', dto);

      expect(result.id).toBe('stripe-id');
      expect(artistRepository.update).toHaveBeenCalledWith(
        { id: 'artist-id' },
        { stripeAccount: { id: 'sa-id' } },
      );
    });

    it('should create company stripe account successfully', async () => {
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        stripeAccount: null,
      } as any);
      stripeCreateConnectedAccountService.createConnectedAccount.mockResolvedValue(
        {
          id: 'stripe-id',
          external_accounts: { data: [{ id: 'ext-id' }] },
        } as any,
      );
      saveStripeAccountDataService.handle.mockResolvedValue({
        id: 'sa-id',
      } as any);
      stripeCreateConnectedAccountService.retrieveConnectedAccount.mockResolvedValue(
        { id: 'stripe-id' } as any,
      );

      const dto = {
        type: StrypeAccountTypeEnum.COMPANY,
        companyData: {
          persons: [
            { email: 'rep@test.com', relationship: { representative: true } },
          ],
        },
      } as any;

      const result = await service.handle('artist-id', dto);

      expect(
        stripeCreateConnectedAccountService.createPerson,
      ).toHaveBeenCalled();
      expect(
        stripeCreateConnectedAccountService.updateConnectedAccount,
      ).toHaveBeenCalled();
      expect(result.id).toBe('stripe-id');
    });

    it('should throw BadRequestException if email is missing', async () => {
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        stripeAccount: null,
      } as any);

      const dto = { type: StrypeAccountTypeEnum.INDIVIDUAL } as any;

      await expect(service.handle('artist-id', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if external account creation fails', async () => {
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        stripeAccount: null,
      } as any);
      stripeCreateConnectedAccountService.createConnectedAccount.mockResolvedValue(
        {
          id: 'stripe-id',
          external_accounts: { data: [] },
        } as any,
      );

      const dto = {
        type: StrypeAccountTypeEnum.INDIVIDUAL,
        individualData: { email: 'test@test.com' },
      } as any;

      await expect(service.handle('artist-id', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete stripe account if an error occurs during creation', async () => {
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        stripeAccount: null,
      } as any);
      stripeCreateConnectedAccountService.createConnectedAccount.mockResolvedValue(
        {
          id: 'stripe-id',
          external_accounts: { data: [{ id: 'ext-id' }] },
        } as any,
      );

      // Simulate error in saveStripeAccountDataService
      saveStripeAccountDataService.handle.mockRejectedValue(
        new Error('DB Error'),
      );

      const dto = {
        type: StrypeAccountTypeEnum.INDIVIDUAL,
        individualData: { email: 'test@test.com' },
      } as any;

      await expect(service.handle('artist-id', dto)).rejects.toThrow(
        'DB Error',
      );
      expect(
        stripeCreateConnectedAccountService.deleteConnectedAccount,
      ).toHaveBeenCalledWith('stripe-id');
    });
  });
});
