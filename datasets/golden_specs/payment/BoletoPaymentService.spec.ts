import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BoletoPaymentService } from './BoletoPaymentService';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { StripeService } from './StripeService';
import { NotFoundException } from '@nestjs/common';

describe('BoletoPaymentService', () => {
  let service: BoletoPaymentService;
  let budgetOfferRepository: any;
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
    budgetOfferRepository = createMockRepository();
    stripeService = {
      confirmBoletoPaymentIntent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoletoPaymentService,
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
      ],
    }).compile();

    service = module.get<BoletoPaymentService>(BoletoPaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateBoletoData', () => {
    it('should generate boleto data successfully when valid data is provided', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: { stripePaymentIntentId: 'pi_12345' },
        },
      };
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer as any);
      stripeService.confirmBoletoPaymentIntent.mockResolvedValue({
        id: 'payment_intent_id',
      } as any);

      // Act
      const result = await service.generateBoletoData(
        'offer-id',
        '123.456.789-00',
        'John Doe',
        'john@example.com',
      );

      // Assert
      expect(budgetOfferRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'offer-id' },
        relations: ['budget', 'budget.owner', 'budget.price'],
      });
      expect(stripeService.confirmBoletoPaymentIntent).toHaveBeenCalledWith(
        'pi_12345',
        '123.456.789-00',
        'John Doe',
        'john@example.com',
      );
      expect(result).toEqual({ id: 'payment_intent_id' });
    });

    it('should throw NotFoundException when stripePaymentIntentId is missing', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: {}, // Missing stripePaymentIntentId
        },
      };
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer as any);

      // Act & Assert
      await expect(
        service.generateBoletoData(
          'offer-id',
          '123.456.789-00',
          'John Doe',
          'john@example.com',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw error when budgetOffer is not found', async () => {
      // Arrange
      budgetOfferRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.generateBoletoData(
          'invalid-id',
          '123.456.789-00',
          'John Doe',
          'john@example.com',
        ),
      ).rejects.toThrow();
    });

    it('should propagate errors when stripeService fails', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: { stripePaymentIntentId: 'pi_12345' },
        },
      };
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer as any);
      stripeService.confirmBoletoPaymentIntent.mockRejectedValue(
        new Error('Stripe API Error'),
      );

      // Act & Assert
      await expect(
        service.generateBoletoData(
          'offer-id',
          '123.456.789-00',
          'John Doe',
          'john@example.com',
        ),
      ).rejects.toThrow('Stripe API Error');
    });
  });
});
