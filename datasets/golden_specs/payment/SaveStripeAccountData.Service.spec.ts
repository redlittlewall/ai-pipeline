import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SaveStripeAccountDataService } from './SaveStripeAccountData.Service';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';
import { BadRequestException, Logger } from '@nestjs/common';

describe('SaveStripeAccountDataService', () => {
  let service: SaveStripeAccountDataService;
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
        SaveStripeAccountDataService,
        {
          provide: getRepositoryToken(StripeAccountEntity),
          useValue: stripeAccountRepository,
        },
      ],
    }).compile();

    service = module.get<SaveStripeAccountDataService>(
      SaveStripeAccountDataService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should execute handle successfully (happy path)', async () => {
      // Arrange
      const stripeAccountId = 'acct_123' as any;
      const stripeBankAccountId = 'bank_456' as any;
      const createStripeAccount = {
        type: 'individual',
        stripeTermsIp: '127.0.0.1',
      } as any;
      const client = {} as any;

      // Act
      const result = await service.handle(
        stripeAccountId,
        stripeBankAccountId,
        createStripeAccount,
        client,
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(stripeAccountId);
      expect(stripeAccountRepository.save).toHaveBeenCalled();

      // Verify that the entity passed to save contains the expected fields
      const savedEntity = (stripeAccountRepository.save as jest.Mock).mock
        .calls[0][0] as any;
      expect(savedEntity.id).toBe(stripeAccountId);
      expect(savedEntity.stripeBankAccountId).toBe(stripeBankAccountId);
      expect(savedEntity.type).toBe(createStripeAccount.type);
      expect(savedEntity.stripeTermsIp).toBe(createStripeAccount.stripeTermsIp);
      expect(savedEntity.artist).toBe(client);
    });

    it('should propagate error when repository.save throws', async () => {
      // Arrange
      const error = new Error('Database error');
      stripeAccountRepository.save.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(
        service.handle(
          'test-id' as any,
          'bank-id' as any,
          {} as any,
          {} as any,
        ),
      ).rejects.toThrow(error);
      expect(stripeAccountRepository.save).toHaveBeenCalled();
    });
  });
});
