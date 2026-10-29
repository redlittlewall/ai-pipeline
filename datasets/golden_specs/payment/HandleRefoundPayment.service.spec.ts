import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HandleRefoundPaymentService } from './HandleRefoundPayment.service';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { StripeService } from '../stripe/StripeService';
import { CalculateRefoundPercentageService } from './CalculateRefoundPercentage.service';
import { CreateStripeTransferService } from 'modules/budget/CreateStripeTransferService';

describe('HandleRefoundPaymentService', () => {
  let service: HandleRefoundPaymentService;
  let clientRepository: any;
  let budgetRepository: any;
  let priceRepository: any;
  let stripeService: any;
  let calculateRefoundPercentageService: any;
  let createStripeTransferService: any;

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
    clientRepository = createMockRepository();
    budgetRepository = createMockRepository();
    priceRepository = createMockRepository();
    stripeService = {
      refoundPaymentIntent: jest.fn(),
    };
    calculateRefoundPercentageService = {
      handle: jest.fn(),
    };
    createStripeTransferService = {
      handle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandleRefoundPaymentService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(PriceEntity),
          useValue: priceRepository,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
        {
          provide: CalculateRefoundPercentageService,
          useValue: calculateRefoundPercentageService,
        },
        {
          provide: CreateStripeTransferService,
          useValue: createStripeTransferService,
        },
      ],
    }).compile();

    service = module.get<HandleRefoundPaymentService>(
      HandleRefoundPaymentService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    const mockClient = { id: 'client-id' } as any;
    const mockArtist = {
      id: 'artist-id',
      stripeAccount: { id: 'stripe-account-id' },
    } as any;
    const baseBudget = {
      id: 'budget-id',
      price: {
        stripePaymentIntentId: 'pi_123',
        received: true,
        refunded: false,
        totalValue: 1000,
      },
      approvedSchedule: {} as any,
      selectedArtist: mockArtist,
    } as any;

    it('should execute handle successfully (happy path)', async () => {
      // Arrange
      budgetRepository.findOne.mockResolvedValueOnce(baseBudget as any);
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      calculateRefoundPercentageService.handle.mockResolvedValueOnce(20); // 20%
      stripeService.refoundPaymentIntent.mockResolvedValueOnce(undefined);
      createStripeTransferService.handle.mockResolvedValueOnce(undefined);

      // Act
      const result = await service.handle(
        'user-id',
        'budget-id',
        'customer request',
      );

      // Assert
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'budget-id' },
        relations: [
          'approvedOffer',
          'approvedSchedule',
          'selectedArtist',
          'selectedArtist.stripeAccount',
        ],
      });
      expect(calculateRefoundPercentageService.handle).toHaveBeenCalledWith(
        baseBudget.approvedSchedule,
      );
      expect(stripeService.refoundPaymentIntent).toHaveBeenCalledWith(
        baseBudget.price.stripePaymentIntentId,
        // refoundValue = total - retained (retained = ceil(total * 0.2) = 200, refound = 800)
        800,
        expect.any(String),
      );
      expect(priceRepository.update).toHaveBeenCalledWith(
        { id: baseBudget.price.id },
        expect.objectContaining({
          received: false,
          refunded: true,
          refoundValue: 800,
          artistValue: expect.any(Number),
        }),
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: baseBudget.id },
        expect.objectContaining({
          status: expect.anything(),
          refoundReason: 'customer request',
          refoundedStartedBy: mockClient,
        }),
      );
      expect(createStripeTransferService.handle).toHaveBeenCalledWith(
        expect.any(Number),
        mockArtist.stripeAccount.id,
        baseBudget,
        mockArtist.id,
      );
      expect(result).toBeUndefined(); // method does not return anything
    });

    it('should throw BadRequestException when stripePaymentIntentId is missing', async () => {
      // Arrange
      const budgetMissingIntent = {
        ...baseBudget,
        price: { ...baseBudget.price, stripePaymentIntentId: null },
      } as any;
      budgetRepository.findOne.mockResolvedValueOnce(budgetMissingIntent);

      // Act & Assert
      await expect(
        service.handle('user-id', 'budget-id', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when payment not received', async () => {
      // Arrange
      const budgetNotReceived = {
        ...baseBudget,
        price: { ...baseBudget.price, received: false },
      } as any;
      budgetRepository.findOne.mockResolvedValueOnce(budgetNotReceived);

      // Act & Assert
      await expect(
        service.handle('user-id', 'budget-id', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when already refunded', async () => {
      // Arrange
      const budgetAlreadyRefunded = {
        ...baseBudget,
        price: { ...baseBudget.price, refunded: true },
      } as any;
      budgetRepository.findOne.mockResolvedValueOnce(budgetAlreadyRefunded);

      // Act & Assert
      await expect(
        service.handle('user-id', 'budget-id', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate error from calculateRefoundPercentageService', async () => {
      // Arrange
      budgetRepository.findOne.mockResolvedValueOnce(baseBudget as any);
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      calculateRefoundPercentageService.handle.mockRejectedValueOnce(
        new Error('Calc error'),
      );

      // Act & Assert
      await expect(
        service.handle('user-id', 'budget-id', 'reason'),
      ).rejects.toThrow('Calc error');
    });
  });
});
