import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateStripeTransferService } from './CreateStripeTransferService';
import { ArtistPayoutRequest } from 'model/payment/ArtistPayoutRequest.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { StripeService } from 'modules/payment/stripe/StripeService';

describe('CreateStripeTransferService', () => {
  let service: CreateStripeTransferService;
  let artistPayoutTransactionRepository: any;
  let priceEntityRepository: any;
  let stripeService: any;

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
    artistPayoutTransactionRepository = createMockRepository();
    priceEntityRepository = createMockRepository();
    stripeService = {
      createTransaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateStripeTransferService,
        {
          provide: getRepositoryToken(ArtistPayoutRequest),
          useValue: artistPayoutTransactionRepository,
        },
        {
          provide: getRepositoryToken(PriceEntity),
          useValue: priceEntityRepository,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
      ],
    }).compile();

    service = module.get<CreateStripeTransferService>(
      CreateStripeTransferService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should execute handle successfully and update price entity', async () => {
      // Arrange
      const mockValue = 1000;
      const mockStripeAccount = 'acct_12345';
      const mockArtistId = 'artist-uuid-1';
      const mockBudget = {
        id: 'budget-uuid-1',
        price: {
          id: 'price-uuid-1',
          sourceTransaction: 'ch_12345',
          currency: 'BRL',
          artistValue: 800,
        },
      } as any;

      const mockStripeTransaction = { id: 'txn_12345' };
      stripeService.createTransaction.mockResolvedValueOnce(
        mockStripeTransaction,
      );

      const mockSavedArtistPayout = { id: 'payout-req-1' };
      artistPayoutTransactionRepository.save.mockResolvedValueOnce(
        mockSavedArtistPayout as any,
      );

      // Act
      await service.handle(
        mockValue,
        mockStripeAccount,
        mockBudget,
        mockArtistId,
      );

      // Assert
      expect(stripeService.createTransaction).toHaveBeenCalledWith(
        mockBudget.id,
        mockStripeAccount,
        mockBudget.price.sourceTransaction,
        mockBudget.price.currency,
        mockValue,
      );

      expect(artistPayoutTransactionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: mockBudget.price.artistValue,
          target: mockArtistId,
          budget: mockBudget.id,
        }),
      );

      expect(priceEntityRepository.update).toHaveBeenCalledWith(
        { id: mockBudget.price.id },
        { payoutRequested: mockSavedArtistPayout },
      );
    });

    it('should propagate errors when stripeService.createTransaction fails', async () => {
      // Arrange
      stripeService.createTransaction.mockRejectedValueOnce(
        new Error('Stripe API error'),
      );
      const mockBudget = {
        id: 'budget-1',
        price: {
          sourceTransaction: 'src-1',
          currency: 'USD',
          artistValue: 500,
        },
      } as any;

      // Act & Assert
      await expect(
        service.handle(500, 'acct_1', mockBudget, 'artist-1'),
      ).rejects.toThrow('Stripe API error');
      expect(artistPayoutTransactionRepository.save).not.toHaveBeenCalled();
      expect(priceEntityRepository.update).not.toHaveBeenCalled();
    });

    it('should propagate errors when saving artist payout request fails', async () => {
      // Arrange
      stripeService.createTransaction.mockResolvedValueOnce({ id: 'txn_123' });
      artistPayoutTransactionRepository.save.mockRejectedValueOnce(
        new Error('Database error'),
      );
      const mockBudget = {
        id: 'budget-1',
        price: {
          id: 'price-1',
          sourceTransaction: 'src-1',
          currency: 'BRL',
          artistValue: 500,
        },
      } as any;

      // Act & Assert
      await expect(
        service.handle(500, 'acct_1', mockBudget, 'artist-1'),
      ).rejects.toThrow('Database error');
      expect(priceEntityRepository.update).not.toHaveBeenCalled();
    });
  });
});
