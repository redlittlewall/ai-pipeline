import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HandlePayoutUpdatedService } from './HandlePayoutUpdated.Service';
import { ArtistPayoutRequest } from 'model/payment/ArtistPayoutRequest.entity';
import { ArtistPayoutFinished } from 'model/payment/ArtistPayoutFinished.entity';
import { Artist } from 'model/users/Artist.entity';
import { Budget } from 'model/budget/Budget.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { NotFoundException } from '@nestjs/common';

describe('HandlePayoutUpdatedService', () => {
  let service: HandlePayoutUpdatedService;
  let artistPayoutRequestRepository: any;
  let artistPayoutFinishedRepository: any;
  let artistRepository: any;
  let budgetRepository: any;
  let priceEntityRepository: any;

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
    artistPayoutRequestRepository = createMockRepository();
    artistPayoutFinishedRepository = createMockRepository();
    artistRepository = createMockRepository();
    budgetRepository = createMockRepository();
    priceEntityRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandlePayoutUpdatedService,
        {
          provide: getRepositoryToken(ArtistPayoutRequest),
          useValue: artistPayoutRequestRepository,
        },
        {
          provide: getRepositoryToken(ArtistPayoutFinished),
          useValue: artistPayoutFinishedRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(PriceEntity),
          useValue: priceEntityRepository,
        },
      ],
    }).compile();

    service = module.get<HandlePayoutUpdatedService>(
      HandlePayoutUpdatedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    const commonParams = {
      externalAccountDestination: 'bank_123',
      payoutId: 'payout_456',
      traceId: 'trace_789',
      stripeBalanceTransactionId: 'bal_tx_001',
      payoutDate: new Date('2023-01-01') as any,
      payoutAmount: 1000,
      payoutCurrency: 'usd',
      eventTimestamp: new Date('2023-01-01') as any,
    };

    it('should execute handle successfully when artist and payout transactions exist', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist_1',
        stripeAccount: {
          stripeBankAccountId: commonParams.externalAccountDestination,
        },
      } as any;
      artistRepository.findOne.mockResolvedValueOnce(mockArtist);

      const mockPayoutTransaction = {
        id: 'req_1',
        budget: {
          price: { id: 'price_1' },
        },
      } as any;
      artistPayoutRequestRepository.find.mockResolvedValueOnce([
        mockPayoutTransaction,
      ] as any);

      // Act
      await service.handle(
        commonParams.externalAccountDestination as any,
        commonParams.payoutId as any,
        commonParams.traceId as any,
        commonParams.stripeBalanceTransactionId as any,
        commonParams.payoutDate as any,
        commonParams.payoutAmount as any,
        commonParams.payoutCurrency as any,
        commonParams.eventTimestamp as any,
      );

      // Assert
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: {
          stripeAccount: {
            stripeBankAccountId: commonParams.externalAccountDestination,
          },
        },
        relations: ['stripeAccount'],
      });
      expect(artistPayoutFinishedRepository.save).toHaveBeenCalled();
      expect(artistPayoutRequestRepository.update).toHaveBeenCalledWith(
        { id: mockPayoutTransaction.id },
        { artistPayoutFinished: expect.any(Object) },
      );
      expect(priceEntityRepository.update).toHaveBeenCalledWith(
        { id: mockPayoutTransaction.budget.price.id },
        { payoutFinished: expect.any(Object) },
      );
    });

    it('should execute handle successfully when no pending payout transactions exist', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist_2',
        stripeAccount: {
          stripeBankAccountId: commonParams.externalAccountDestination,
        },
      } as any;
      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      artistPayoutRequestRepository.find.mockResolvedValueOnce([] as any);

      // Act
      await service.handle(
        commonParams.externalAccountDestination as any,
        commonParams.payoutId as any,
        commonParams.traceId as any,
        commonParams.stripeBalanceTransactionId as any,
        commonParams.payoutDate as any,
        commonParams.payoutAmount as any,
        commonParams.payoutCurrency as any,
        commonParams.eventTimestamp as any,
      );

      // Assert
      expect(artistRepository.findOne).toHaveBeenCalled();
      expect(artistPayoutFinishedRepository.save).toHaveBeenCalled();
      // No updates should be performed when there are no transactions
      expect(artistPayoutRequestRepository.update).not.toHaveBeenCalled();
      expect(priceEntityRepository.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when artist is not found', async () => {
      // Arrange
      artistRepository.findOne.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.handle(
          commonParams.externalAccountDestination as any,
          commonParams.payoutId as any,
          commonParams.traceId as any,
          commonParams.stripeBalanceTransactionId as any,
          commonParams.payoutDate as any,
          commonParams.payoutAmount as any,
          commonParams.payoutCurrency as any,
          commonParams.eventTimestamp as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate errors from repository methods', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist_3',
        stripeAccount: {
          stripeBankAccountId: commonParams.externalAccountDestination,
        },
      } as any;
      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      const error = new Error('Database unavailable');
      artistPayoutRequestRepository.find.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(
        service.handle(
          commonParams.externalAccountDestination as any,
          commonParams.payoutId as any,
          commonParams.traceId as any,
          commonParams.stripeBalanceTransactionId as any,
          commonParams.payoutDate as any,
          commonParams.payoutAmount as any,
          commonParams.payoutCurrency as any,
          commonParams.eventTimestamp as any,
        ),
      ).rejects.toThrow('Database unavailable');
    });
  });
});
