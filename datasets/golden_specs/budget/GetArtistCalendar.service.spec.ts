import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetArtistCalendarService } from './GetArtistCalendar.service';
import { Budget } from 'model/budget/Budget.entity';
import { GetBudgetsService } from 'modules/budget/GetBudgets.service';
import { GetSizesService } from 'modules/tattoo/details/GetSizes.service';

describe('GetArtistCalendarService', () => {
  let service: GetArtistCalendarService;
  let budgetRepository: any;
  let getBudgetsService: any;
  let getSizesService: any;

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
    getBudgetsService = {
      getMinimalBudgetById: jest.fn(),
    };
    getSizesService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetArtistCalendarService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: GetBudgetsService,
          useValue: getBudgetsService,
        },
        {
          provide: GetSizesService,
          useValue: getSizesService,
        },
      ],
    }).compile();

    service = module.get<GetArtistCalendarService>(GetArtistCalendarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should execute get successfully and return empty array when no budgets exist', async () => {
      // Given
      budgetRepository
        .createQueryBuilder()
        .getRawMany.mockResolvedValueOnce([]);

      // When
      const result = await service.get('artist-123', 2023, 10);

      // Then
      expect(result).toEqual([]);
      expect(budgetRepository.createQueryBuilder).toHaveBeenCalledWith(
        'budget',
      );
      expect(budgetRepository.createQueryBuilder().where).toHaveBeenCalledWith(
        'budget.selectedArtist = :artistId',
        { artistId: 'artist-123' },
      );
    });

    it('should fetch budgets and group them correctly by date (Happy Path)', async () => {
      // Given
      const artistId = 'artist-123';
      const year = 2023;
      const month = 10;

      const rawQueryResults = [
        { budget_id: 'budget-1', date: new Date(2023, 9, 15) },
        { budget_id: 'budget-2', date: new Date(2023, 9, 15) },
        { budget_id: 'budget-3', date: new Date(2023, 9, 20) },
      ];

      budgetRepository
        .createQueryBuilder()
        .getRawMany.mockResolvedValueOnce(rawQueryResults);

      const mockMinimalBudget1 = {
        id: 'budget-1',
        scheduledAt: { date: new Date(2023, 9, 15, 10, 0, 0) },
      };
      const mockMinimalBudget2 = {
        id: 'budget-2',
        scheduledAt: { date: new Date(2023, 9, 15, 14, 0, 0) },
      };
      const mockMinimalBudget3 = {
        id: 'budget-3',
        scheduledAt: { date: new Date(2023, 9, 20, 11, 0, 0) },
      };

      getBudgetsService.getMinimalBudgetById
        .mockResolvedValueOnce(mockMinimalBudget1 as any)
        .mockResolvedValueOnce(mockMinimalBudget2 as any)
        .mockResolvedValueOnce(mockMinimalBudget3 as any);

      // When
      const result = await service.get(artistId, year, month);

      // Then
      expect(result).toHaveLength(2);

      const day15Group = result.find(
        (item) =>
          item.date.getTime() === new Date(2023, 9, 15, 0, 0, 0, 0).getTime(),
      );
      expect(day15Group).toBeDefined();
      expect(day15Group?.budgets).toHaveLength(2);
      expect(day15Group?.budgets).toEqual([
        mockMinimalBudget1,
        mockMinimalBudget2,
      ]);

      const day20Group = result.find(
        (item) =>
          item.date.getTime() === new Date(2023, 9, 20, 0, 0, 0, 0).getTime(),
      );
      expect(day20Group).toBeDefined();
      expect(day20Group?.budgets).toHaveLength(1);
      expect(day20Group?.budgets).toEqual([mockMinimalBudget3]);
    });

    it('should propagate errors when repository query fails', async () => {
      // Given
      budgetRepository
        .createQueryBuilder()
        .getRawMany.mockRejectedValueOnce(new Error('Database error'));

      // When & Then
      await expect(service.get('artist-123', 2023, 10)).rejects.toThrow(
        'Database error',
      );
    });

    it('should propagate errors when getBudgetsService fails', async () => {
      // Given
      const rawQueryResults = [
        { budget_id: 'budget-1', date: new Date(2023, 9, 15) },
      ];
      budgetRepository
        .createQueryBuilder()
        .getRawMany.mockResolvedValueOnce(rawQueryResults);
      getBudgetsService.getMinimalBudgetById.mockRejectedValueOnce(
        new Error('Failed to fetch budget details'),
      );

      // When & Then
      await expect(service.get('artist-123', 2023, 10)).rejects.toThrow(
        'Failed to fetch budget details',
      );
    });
  });
});
