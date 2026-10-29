import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreatePaymentSheetService } from './CreatePaymentSheet.service';
import { Budget } from 'model/budget/Budget.entity';
import { Client } from 'model/users/Client.entity';
import { StripeService } from './stripe/StripeService';

describe('CreatePaymentSheetService', () => {
  let service: CreatePaymentSheetService;
  let budgetRepository: any;
  let clientRepository: any;
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
    budgetRepository = createMockRepository();
    clientRepository = createMockRepository();
    stripeService = {
      createCustomer: jest.fn(),
      createCustomerEphemeralKey: jest.fn(),
      getPaymentIntent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreatePaymentSheetService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
      ],
    }).compile();

    service = module.get<CreatePaymentSheetService>(CreatePaymentSheetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPaymentSheet', () => {
    it('should execute createPaymentSheet successfully', async () => {
      // Arrange
      const mockBudget = {
        price: { stripePaymentIntentId: 'pi_123' },
        owner: { id: 'client-id', stripeCustomer: 'cus_123' },
      } as any;
      budgetRepository.findOne.mockResolvedValue(mockBudget);
      stripeService.getPaymentIntent.mockResolvedValue({
        client_secret: 'secret_123',
      });
      stripeService.createCustomerEphemeralKey.mockResolvedValue({
        secret: 'ek_123',
      });

      // Act
      const result = await service.createPaymentSheet('client-id', 'offer-id');

      // Assert
      expect(result).toEqual({
        clientSecret: 'secret_123',
        ephemeralKeySecret: 'ek_123',
        customer: 'cus_123',
        publishableKey: process.env.SSECRET,
      });
    });

    it('should throw NotFoundException when budget is not found', async () => {
      // Arrange
      budgetRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createPaymentSheet('client-id', 'offer-id'),
      ).rejects.toThrow();
    });

    it('should throw NotFoundException when stripePaymentIntentId is missing', async () => {
      // Arrange
      const mockBudget = {
        price: { stripePaymentIntentId: null },
        owner: { id: 'client-id' },
      } as any;
      budgetRepository.findOne.mockResolvedValue(mockBudget);

      // Act & Assert
      await expect(
        service.createPaymentSheet('client-id', 'offer-id'),
      ).rejects.toThrow();
    });

    it('should create customer if stripeCustomer is missing', async () => {
      // Arrange
      const mockBudget = {
        price: { stripePaymentIntentId: 'pi_123' },
        owner: { id: 'client-id', stripeCustomer: null },
      } as any;
      budgetRepository.findOne.mockResolvedValue(mockBudget);
      stripeService.getPaymentIntent.mockResolvedValue({
        client_secret: 'secret_123',
      });
      stripeService.createCustomer.mockResolvedValue({ id: 'new_cus_123' });
      stripeService.createCustomerEphemeralKey.mockResolvedValue({
        secret: 'ek_123',
      });

      // Act
      const result = await service.createPaymentSheet('client-id', 'offer-id');

      // Assert
      expect(stripeService.createCustomer).toHaveBeenCalled();
      expect(clientRepository.update).toHaveBeenCalled();
      expect(result.customer).toBe('new_cus_123');
    });
  });
});
