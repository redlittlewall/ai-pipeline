import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BudgetHasNotificationService } from './BudgetHasNotification.service';
import { BudgetNotifications } from 'model/budget/BudgetNotification.entity';

describe('BudgetHasNotificationService', () => {
  let service: BudgetHasNotificationService;
  let budgetNotificationsRepository: any;

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
    budgetNotificationsRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetHasNotificationService,
        {
          provide: getRepositoryToken(BudgetNotifications),
          useValue: budgetNotificationsRepository,
        },
      ],
    }).compile();

    service = module.get<BudgetHasNotificationService>(
      BudgetHasNotificationService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verify', () => {
    it('should return true when there are unviewed notifications for the budget and user', async () => {
      // Given (Arrange)
      budgetNotificationsRepository.find.mockResolvedValueOnce([
        { id: 'notif-1' },
      ] as any);

      // When (Act)
      const result = await service.verify('user-123', 'budget-456');

      // Then (Assert)
      expect(result).toBe(true);
      expect(budgetNotificationsRepository.find).toHaveBeenCalledWith({
        where: {
          budget: { id: 'budget-456' },
          target: { id: 'user-123' },
          targetViewAt: expect.anything(), // IsNull() helper
        },
      });
    });

    it('should return false when no unviewed notifications are found', async () => {
      // Given (Arrange)
      budgetNotificationsRepository.find.mockResolvedValueOnce([]);

      // When (Act)
      const result = await service.verify('user-123', 'budget-456');

      // Then (Assert)
      expect(result).toBe(false);
      expect(budgetNotificationsRepository.find).toHaveBeenCalled();
    });

    it('should propagate errors when the repository fails', async () => {
      // Given (Arrange)
      const error = new Error('Database connection failed');
      budgetNotificationsRepository.find.mockRejectedValueOnce(error);

      // When & Then (Act & Assert)
      await expect(service.verify('user-1', 'budget-1')).rejects.toThrow(
        'Database connection failed',
      );
    });
  });
});
