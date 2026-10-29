import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetStripeDatabaseDataService } from './GetStripeDatabaseData.service';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';
import { GetCompanyAccountPersonsService } from './GetCompanyAccountPersons.service';
import { NotFoundException } from '@nestjs/common';

describe('GetStripeDatabaseDataService', () => {
  let service: GetStripeDatabaseDataService;
  let stripeAccountRepository: any;
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
    stripeAccountRepository = createMockRepository();
    getCompanyAccountPersonsService = {
      handle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetStripeDatabaseDataService,
        {
          provide: getRepositoryToken(StripeAccountEntity),
          useValue: stripeAccountRepository,
        },
        {
          provide: GetCompanyAccountPersonsService,
          useValue: getCompanyAccountPersonsService,
        },
      ],
    }).compile();

    service = module.get<GetStripeDatabaseDataService>(
      GetStripeDatabaseDataService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should execute handle successfully (basic sanity)', async () => {
      const result = await service.handle('test-id' as any);
      expect(result).toBeDefined();
    });

    it('should return mapped DTO when StripeAccount exists and persons are returned', async () => {
      // Arrange
      const mockStripeAccount = {
        accountApproved: true,
        accoutInRisk: false,
        accountCreated: true,
        documentsSent: true,
        stripeCreationDelayedFlag: false,
        type: 'company',
      } as any;

      const mockPersons = [
        { id: 'person-1' } as any,
        { id: 'person-2' } as any,
      ];

      stripeAccountRepository.findOne.mockResolvedValueOnce(mockStripeAccount);
      getCompanyAccountPersonsService.handle.mockResolvedValueOnce(mockPersons);

      // Act
      const result = await service.handle('user-123' as any);

      // Assert
      expect(stripeAccountRepository.findOne).toHaveBeenCalledWith({
        where: { artist: { id: 'user-123' } },
      });
      expect(getCompanyAccountPersonsService.handle).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toEqual({
        accountApproved: true,
        accountRisk: false,
        accountCreated: true,
        documentsSent: true,
        accountDelayed: false,
        personDocuments: mockPersons,
        companyType: 'company',
      });
    });

    it('should return default false flags when StripeAccount is null', async () => {
      // Arrange
      stripeAccountRepository.findOne.mockResolvedValueOnce(null);
      const mockPersons = [] as any;
      getCompanyAccountPersonsService.handle.mockResolvedValueOnce(mockPersons);

      // Act
      const result = await service.handle('user-no-account' as any);

      // Assert
      expect(stripeAccountRepository.findOne).toHaveBeenCalled();
      expect(result.accountApproved).toBe(false);
      expect(result.accountRisk).toBe(false);
      expect(result.accountCreated).toBe(false);
      expect(result.documentsSent).toBe(false);
      expect(result.accountDelayed).toBe(false);
      expect(result.personDocuments).toBe(mockPersons);
      expect(result.companyType).toBeUndefined();
    });

    it('should propagate repository errors', async () => {
      // Arrange
      const error = new Error('DB failure');
      stripeAccountRepository.findOne.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.handle('any-id' as any)).rejects.toThrow(
        'DB failure',
      );
    });

    it('should propagate errors from GetCompanyAccountPersonsService', async () => {
      // Arrange
      const mockStripeAccount = {
        accountApproved: false,
        accoutInRisk: false,
        accountCreated: false,
        documentsSent: false,
        stripeCreationDelayedFlag: false,
        type: null,
      } as any;
      stripeAccountRepository.findOne.mockResolvedValueOnce(mockStripeAccount);
      const error = new Error('Persons service failure');
      getCompanyAccountPersonsService.handle.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.handle('user-err' as any)).rejects.toThrow(
        'Persons service failure',
      );
    });
  });
});
