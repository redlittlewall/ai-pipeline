import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UpdateStripePersonInCompanyDocumentService } from './UpdateStripePersonInCompanyDocument.Service';
import { Artist } from 'model/users/Artist.entity';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';
import { StripeCreateConnectedAccountService } from './StripeCreateConnectedAccount.service';
import { GetCompanyAccountPersonsService } from './GetCompanyAccountPersons.service';

describe('UpdateStripePersonInCompanyDocumentService', () => {
  let service: UpdateStripePersonInCompanyDocumentService;
  let artistRepository: any;
  let stripeAccountRepository: any;
  let stripeCreateConnectedAccountService: any;
  let getCompanyAccountPersonsService: any;

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
      atualizarDocumentosPersonCompany: jest.fn(),
    };
    getCompanyAccountPersonsService = {
      handle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateStripePersonInCompanyDocumentService,
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
          provide: GetCompanyAccountPersonsService,
          useValue: getCompanyAccountPersonsService,
        },
      ],
    }).compile();

    service = module.get<UpdateStripePersonInCompanyDocumentService>(
      UpdateStripePersonInCompanyDocumentService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should execute successfully when stripeAccount is found', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist-id',
        stripeAccount: { id: 'stripe-id' },
      };
      const mockStripeAccount = { id: 'stripe-id' };

      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);
      stripeAccountRepository.findOne.mockResolvedValueOnce(
        mockStripeAccount as any,
      );

      // Act
      await service.handle('artist-id', 'person-id', {} as any);

      // Assert
      expect(
        stripeCreateConnectedAccountService.atualizarDocumentosPersonCompany,
      ).toHaveBeenCalledWith('stripe-id', 'person-id', {});
    });

    it('should execute successfully and call getCompanyAccountPersonsService when stripeAccount is not found', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist-id',
        stripeAccount: { id: 'stripe-id' },
      };

      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);
      stripeAccountRepository.findOne.mockResolvedValueOnce(null); // Not found
      getCompanyAccountPersonsService.handle.mockResolvedValueOnce([]);

      // Act
      await service.handle('artist-id', 'person-id', {} as any);

      // Assert
      expect(getCompanyAccountPersonsService.handle).toHaveBeenCalledWith(
        'artist-id',
      );
      expect(
        stripeCreateConnectedAccountService.atualizarDocumentosPersonCompany,
      ).toHaveBeenCalledWith('stripe-id', 'person-id', {});
    });

    it('should throw error when artist is not found', async () => {
      // Arrange
      artistRepository.findOne.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.handle('invalid-id', 'person-id', {} as any),
      ).rejects.toThrow();
    });
  });
});
