import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { HandleFailedPaymentService } from './HandleFailedPayment.service';
import { Budget } from 'model/budget/Budget.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { BudgetNotificationService } from 'modules/budget/notification/BudgetNotification.service';
import { BudgetStatus } from 'enums/BudgetStatus';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';

describe('HandleFailedPaymentService', () => {
  let service: HandleFailedPaymentService;
  let budgetRepository: any;
  let priceEntityRepository: any;
  let budgetNotificationService: any;

  beforeEach(async () => {
    budgetRepository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    priceEntityRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    budgetNotificationService = {
      notify: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandleFailedPaymentService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(PriceEntity),
          useValue: priceEntityRepository,
        },
        {
          provide: BudgetNotificationService,
          useValue: budgetNotificationService,
        },
      ],
    }).compile();

    service = module.get<HandleFailedPaymentService>(HandleFailedPaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should throw NotFoundException when budget is null', async () => {
      budgetRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.handle('pi_12345')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update budget status to PAYMENT_PENDING, update price entity, and notify client', async () => {
      const mockBudget = {
        id: 'budget-99',
        owner: { id: 'user-client-1' },
        selectedArtist: {
          client: { id: 'artist-client-1' },
        },
        approvedOffer: {
          price: {
            id: 'price-123',
          },
          budget: null as any,
        },
      };
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget);

      await service.handle('pi_12345');

      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: {
          approvedOffer: { price: { stripePaymentIntentId: 'pi_12345' } },
        },
        relations: [
          'owner',
          'selectedArtist',
          'selectedArtist.client',
          'approvedOffer',
        ],
      });

      expect(mockBudget.approvedOffer.budget).toBe(mockBudget);

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'budget-99' },
        { status: BudgetStatus.PAYMENT_PENDING },
      );

      expect(priceEntityRepository.update).toHaveBeenCalledWith(
        { id: 'price-123' },
        {
          paymentError: expect.any(String),
          received: false,
          receivedAt: null,
        },
      );

      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockBudget.owner,
        mockBudget.selectedArtist.client,
        BudgetNotificationType.PAYMENT_ERROR,
      );
    });
  });
});
