import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VerifyStripeApprovalDelayedService } from './VerifyStripeApprovalDelayed.Service';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';

describe('VerifyStripeApprovalDelayedService', () => {
  let service: VerifyStripeApprovalDelayedService;
  let stripeAccountRepository: any;

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
    stripeAccountRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerifyStripeApprovalDelayedService,
        {
          provide: getRepositoryToken(StripeAccountEntity),
          useValue: stripeAccountRepository,
        },
      ],
    }).compile();

    service = module.get<VerifyStripeApprovalDelayedService>(
      VerifyStripeApprovalDelayedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should mark accounts as delayed when they meet criteria (Happy Path)', async () => {
      // Arrange
      const mockAccounts = [
        { id: '1', stripeCreationDelayedFlag: false },
        { id: '2', stripeCreationDelayedFlag: false },
      ] as any;

      stripeAccountRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockAccounts);

      // Act
      await service.handle();

      // Assert
      expect(
        stripeAccountRepository.createQueryBuilder().where,
      ).toHaveBeenCalled();
      expect(
        stripeAccountRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledTimes(3);
      expect(stripeAccountRepository.save).toHaveBeenCalledTimes(2);
      expect(mockAccounts[0].stripeCreationDelayedFlag).toBe(true);
      expect(mockAccounts[1].stripeCreationDelayedFlag).toBe(true);
    });

    it('should do nothing when no accounts are found (Empty State)', async () => {
      // Arrange
      stripeAccountRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // Act
      await service.handle();

      // Assert
      expect(stripeAccountRepository.save).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository fails (Sad Path)', async () => {
      // Arrange
      stripeAccountRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('Database connection failed'));

      // Act & Assert
      await expect(service.handle()).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should propagate errors when save fails (Sad Path)', async () => {
      // Arrange
      const mockAccounts = [{ id: '1' }] as any;
      stripeAccountRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockAccounts);
      stripeAccountRepository.save.mockRejectedValueOnce(
        new Error('Save failed'),
      );

      // Act & Assert
      await expect(service.handle()).rejects.toThrow('Save failed');
    });
  });
});
