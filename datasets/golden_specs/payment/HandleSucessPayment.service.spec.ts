import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HandleSucessPaymentService } from './HandleSucessPayment.service';
import { Budget } from 'model/budget/Budget.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { BudgetNotifications } from 'model/budget/BudgetNotification.entity';
import { QrCodeService } from '../QrCode.Service';
import { BudgetChatSocketService } from 'modules/budget/chat/BudgetChatSocket.Service';
import { BudgetNotificationService } from 'modules/budget/notification/BudgetNotification.service';
import { NotFoundException } from '@nestjs/common';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';

describe('HandleSucessPaymentService', () => {
  let service: HandleSucessPaymentService;
  let budgetRepository: any;
  let priceEntityRepository: any;
  let budgetNotificationsRepository: any;
  let qrCodeService: any;
  let budgetChatSocketService: any;
  let budgetNotificationService: any;

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
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };

    budgetRepository = createMockRepository();
    priceEntityRepository = createMockRepository();
    budgetNotificationsRepository = createMockRepository();
    qrCodeService = {
      generate: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };
    budgetNotificationService = {
      notify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandleSucessPaymentService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(PriceEntity),
          useValue: priceEntityRepository,
        },
        {
          provide: getRepositoryToken(BudgetNotifications),
          useValue: budgetNotificationsRepository,
        },
        {
          provide: QrCodeService,
          useValue: qrCodeService,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
        {
          provide: BudgetNotificationService,
          useValue: budgetNotificationService,
        },
      ],
    }).compile();

    service = module.get<HandleSucessPaymentService>(
      HandleSucessPaymentService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    const mockBudget = {
      id: 'budget-id',
      price: { id: 'price-id' } as any,
      owner: { id: 'owner-id' } as any,
      selectedArtist: {
        id: 'artist-id',
        client: { id: 'client-id' } as any,
      } as any,
    } as any;

    it('should execute handle successfully (happy path)', async () => {
      // Arrange
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);

      // Act
      await service.handle('pi_123' as any, 'ch_456' as any);

      // Assert
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { price: { stripePaymentIntentId: 'pi_123' } },
        relations: ['owner', 'selectedArtist', 'selectedArtist.client'],
      });

      expect(priceEntityRepository.update).toHaveBeenCalledWith(
        { id: mockBudget.price.id },
        {
          received: true,
          receivedAt: expect.any(Date),
          paymentError: null,
          sourceTransaction: 'ch_456',
        },
      );

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: mockBudget.id },
        { status: 'schedule_pending' }, // enum value string
      );

      expect(qrCodeService.generate).toHaveBeenCalledWith(mockBudget.id);

      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        mockBudget.owner?.id,
        mockBudget.selectedArtist.id,
        mockBudget.id,
      );

      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockBudget.owner,
        mockBudget.selectedArtist.client,
        BudgetNotificationType.NEW_PAYMENT,
      );

      expect(budgetNotificationsRepository.save).toHaveBeenCalledWith({
        budget: mockBudget,
        owner: mockBudget.owner,
        target: mockBudget.selectedArtist.client,
        type: BudgetNotificationType.NEW_PAYMENT,
      });
    });

    it('should throw NotFoundException when budget is not found', async () => {
      // Arrange
      budgetRepository.findOne.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.handle('invalid-pi' as any, 'any-charge' as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate errors from dependencies', async () => {
      // Arrange
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      priceEntityRepository.update.mockRejectedValueOnce(
        new Error('DB failure'),
      );

      // Act & Assert
      await expect(
        service.handle('pi_123' as any, 'ch_456' as any),
      ).rejects.toThrow('DB failure');

      // Since Promise.all starts all promises concurrently, the other
      // dependency calls may already have been invoked before the rejection.
      // We therefore assert that they were called, not that they were omitted.
      expect(budgetRepository.update).toHaveBeenCalled();
      expect(qrCodeService.generate).toHaveBeenCalled();
    });
  });
});
