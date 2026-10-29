import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HandleAccountUpdatedService } from './HandleAccountUpdated.service';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';

describe('HandleAccountUpdatedService', () => {
  let service: HandleAccountUpdatedService;
  let stripeAccountRepository: any;
  let notificationWorkflow: any;

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
    notificationWorkflow = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandleAccountUpdatedService,
        {
          provide: getRepositoryToken(StripeAccountEntity),
          useValue: stripeAccountRepository,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
      ],
    }).compile();

    service = module.get<HandleAccountUpdatedService>(
      HandleAccountUpdatedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should approve a company account and send notification when all conditions are met', async () => {
      // Arrange
      jest.clearAllMocks();
      const accountObject = {
        id: 'acct_company_1',
        capabilities: { transfers: 'active' },
        charges_enabled: true,
        metadata: { userId: 'user-123' },
        company: { name: 'TestCo' },
        individual: null,
      } as any;

      const mockStripeAccount = {
        id: 'acct_company_1',
        accountApproved: false,
        artist: { client: { id: 'client-123' } as any },
      } as any;

      stripeAccountRepository.findOne.mockResolvedValueOnce(mockStripeAccount);

      // Act
      const result = await service.handle(accountObject);

      // Assert
      expect(result).toBeUndefined();
      expect(stripeAccountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountObject.id },
        relations: ['artist', 'artist.client'],
      });
      expect(stripeAccountRepository.update).toHaveBeenCalledWith(
        { id: accountObject.id },
        {
          accountApproved: true,
          accountApprovedAt: expect.any(Date),
          stripeCreationDelayedFlag: false,
          documentsSent: true,
          accoutInRisk: false,
        },
      );
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        accountObject.metadata.userId,
        expect.objectContaining({
          title: expect.objectContaining({
            en: expect.any(String),
            pt: expect.any(String),
          }),
          specificType: expect.anything(),
          type: expect.anything(),
          receiverClient: mockStripeAccount.artist.client,
        }),
        true,
      );
    });

    it('should not update or notify when company account is already approved', async () => {
      // Arrange
      jest.clearAllMocks();
      const accountObject = {
        id: 'acct_company_2',
        capabilities: { transfers: 'active' },
        charges_enabled: true,
        metadata: { userId: 'user-456' },
        company: { name: 'AlreadyApprovedCo' },
        individual: null,
      } as any;

      const mockStripeAccount = {
        id: 'acct_company_2',
        accountApproved: true,
        artist: { client: { id: 'client-456' } as any },
      } as any;

      stripeAccountRepository.findOne.mockResolvedValueOnce(mockStripeAccount);

      // Act
      const result = await service.handle(accountObject);

      // Assert
      expect(result).toBeUndefined();
      expect(stripeAccountRepository.update).not.toHaveBeenCalled();
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should approve an individual account and send notification when verification is verified', async () => {
      // Arrange
      jest.clearAllMocks();
      const accountObject = {
        id: 'acct_individual_1',
        individual: { verification: { status: 'verified' } },
        metadata: { userId: 'user-789' },
        capabilities: null,
        company: null,
      } as any;

      const mockStripeAccount = {
        id: 'acct_individual_1',
        accountApproved: false,
      } as any;

      stripeAccountRepository.findOne.mockResolvedValueOnce(mockStripeAccount);

      // Act
      const result = await service.handle(accountObject);

      // Assert
      expect(result).toBeUndefined();
      expect(stripeAccountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountObject.id },
      });
      expect(stripeAccountRepository.update).toHaveBeenCalledWith(
        { id: accountObject.id },
        {
          accountApproved: true,
          accountApprovedAt: expect.any(Date),
          stripeCreationDelayedFlag: false,
          accoutInRisk: false,
        },
      );
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        accountObject.metadata.userId,
        expect.objectContaining({
          specificType: expect.anything(),
          type: expect.anything(),
          receiverClient: undefined, // individual flow does not set receiverClient
        }),
        true,
      );
    });

    it('should not send notification when individual verification status is not verified', async () => {
      // Arrange
      jest.clearAllMocks();
      const accountObject = {
        id: 'acct_individual_2',
        individual: { verification: { status: 'unverified' } },
        metadata: { userId: 'user-000' },
        capabilities: null,
        company: null,
      } as any;

      // findOne will not be called because verification fails early
      // Act
      const result = await service.handle(accountObject);

      // Assert
      expect(result).toBeUndefined();
      expect(stripeAccountRepository.findOne).not.toHaveBeenCalled();
      expect(stripeAccountRepository.update).not.toHaveBeenCalled();
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should not call notification workflow when userId is missing even if account is approved', async () => {
      // Arrange
      jest.clearAllMocks();
      const accountObject = {
        id: 'acct_company_3',
        capabilities: { transfers: 'active' },
        charges_enabled: true,
        metadata: { userId: null },
        company: { name: 'NoUserIdCo' },
        individual: null,
      } as any;

      const mockStripeAccount = {
        id: 'acct_company_3',
        accountApproved: false,
        artist: { client: { id: 'client-999' } as any },
      } as any;

      stripeAccountRepository.findOne.mockResolvedValueOnce(mockStripeAccount);

      // Act
      const result = await service.handle(accountObject);

      // Assert
      expect(result).toBeUndefined();
      expect(stripeAccountRepository.update).toHaveBeenCalled();
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });
  });
});
