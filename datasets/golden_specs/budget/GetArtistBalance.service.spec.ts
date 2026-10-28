import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetArtistBalanceService } from './GetArtistBalance.service';
import { Budget } from 'model/budget/Budget.entity';
import { BudgetPayoutTypeEnum } from 'enums/BudgetPayoutTypeEnum';

describe('GetArtistBalanceService', () => {
  let service: GetArtistBalanceService;
  let budgetRepository: any;

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
    budgetRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetArtistBalanceService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
      ],
    }).compile();

    service = module.get<GetArtistBalanceService>(GetArtistBalanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDetails', () => {
    it('should return budget balance details for incoming, processing, and finished budgets (Happy Path)', async () => {
      // Arrange
      const artistId = 'artist-123';
      const incomingBudgets = [
        {
          id: 'b1',
          artistBudgetNumber: 1,
          title: 'Budget 1',
          price: { artistValue: 100 },
        },
      ];
      const processingBudgets = [
        {
          id: 'b2',
          artistBudgetNumber: 2,
          title: 'Budget 2',
          price: { payoutRequested: { amount: 200 } },
        },
      ];
      const finishedBudgets = [
        {
          id: 'b3',
          artistBudgetNumber: 3,
          title: 'Budget 3',
          price: {
            payoutFinished: {
              id: 'payout-1',
              amount: 300,
              receivedDate: new Date('2023-01-01'),
            },
          },
        },
      ];

      budgetRepository.find
        .mockResolvedValueOnce(incomingBudgets as any)
        .mockResolvedValueOnce(processingBudgets as any)
        .mockResolvedValueOnce(finishedBudgets as any);

      // Act
      const result = await service.getDetails(artistId);

      // Assert
      expect(budgetRepository.find).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);

      const processingResponse = result.find(
        (r) => r.status === BudgetPayoutTypeEnum.PROCESSING,
      );
      expect(processingResponse).toBeDefined();
      expect(processingResponse?.amount).toBe(200);

      const incomingResponse = result.find(
        (r) => r.status === BudgetPayoutTypeEnum.INCOMING,
      );
      expect(incomingResponse).toBeDefined();
      expect(incomingResponse?.amount).toBe(100);

      const finishedResponse = result.find(
        (r) => r.status === BudgetPayoutTypeEnum.RECEIVED,
      );
      expect(finishedResponse).toBeDefined();
      expect(finishedResponse?.amount).toBe(300);
    });

    it('should return an empty array when no budgets are found (Empty State)', async () => {
      // Arrange
      budgetRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Act
      const result = await service.getDetails('artist-123');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return details when only incoming budgets exist', async () => {
      // Arrange
      const incomingBudgets = [
        {
          id: 'b1',
          artistBudgetNumber: 1,
          title: 'Budget 1',
          price: { artistValue: 150 },
        },
      ];

      budgetRepository.find
        .mockResolvedValueOnce(incomingBudgets as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Act
      const result = await service.getDetails('artist-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(BudgetPayoutTypeEnum.INCOMING);
      expect(result[0].amount).toBe(150);
    });

    it('should propagate errors when repository fails', async () => {
      // Arrange
      budgetRepository.find.mockRejectedValueOnce(new Error('Database error'));

      // Act & Assert
      await expect(service.getDetails('artist-123')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('get', () => {
    it('should return balance dto with schedule count successfully (Happy Path)', async () => {
      // Arrange
      const artistId = 'artist-123';
      const scheduleCount = 5;
      budgetRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(scheduleCount);

      // Act
      const result = await service.get(artistId);

      // Assert
      expect(budgetRepository.createQueryBuilder).toHaveBeenCalledWith(
        'budget',
      );
      expect(
        budgetRepository.createQueryBuilder().innerJoin,
      ).toHaveBeenCalledWith('budget.approvedSchedule', 'approvedSchedule');
      expect(budgetRepository.createQueryBuilder().where).toHaveBeenCalledWith(
        'budget.selectedArtist = :artistId',
        { artistId },
      );
      expect(result).toEqual({
        receivedBalance: 0,
        processingBalance: 0,
        incomingBalance: 0,
        scheduleCount: scheduleCount,
      });
    });

    it('should propagate error when query builder fails', async () => {
      // Arrange
      budgetRepository
        .createQueryBuilder()
        .getCount.mockRejectedValueOnce(new Error('Query failed'));

      // Act & Assert
      await expect(service.get('artist-123')).rejects.toThrow('Query failed');
    });
  });
});
