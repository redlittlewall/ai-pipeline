import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DefineBudgetOfferService } from './DefineBudgetOffer.Service';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { Artist } from 'model/users/Artist.entity';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { BudgetNotificationService } from '../notification/BudgetNotification.service';
import { AddBudgetChatMessageService } from '../chat/AddBudgetChatMessage.Service';
import { BudgetChatSocketService } from '../chat/BudgetChatSocket.Service';
import { StripeService } from 'modules/payment/stripe/StripeService';
import { AvailabilityStatus } from 'enums/AvailabilityStatus';
import { BudgetType } from 'enums/BudgetType';
import { BudgetStatus } from 'enums/BudgetStatus';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';

describe('DefineBudgetOfferService', () => {
  let service: DefineBudgetOfferService;
  let clientRepository: any;
  let budgetRepository: any;
  let priceRepository: any;
  let artistRepository: any;
  let budgetOfferRepository: any;
  let budgetNotificationService: any;
  let addBudgetChatMessageService: any;
  let budgetChatSocketService: any;
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
    clientRepository = createMockRepository();
    budgetRepository = createMockRepository();
    priceRepository = createMockRepository();
    artistRepository = createMockRepository();
    budgetOfferRepository = createMockRepository();
    budgetNotificationService = {
      notify: jest.fn(),
    };
    addBudgetChatMessageService = {
      newChatMessage: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };
    stripeService = {
      createCustomer: jest.fn(),
      createPaymentIntent: jest.fn(),
      updatePaymentIntentPrice: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefineBudgetOfferService,
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
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: BudgetNotificationService,
          useValue: budgetNotificationService,
        },
        {
          provide: AddBudgetChatMessageService,
          useValue: addBudgetChatMessageService,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
      ],
    }).compile();

    service = module.get<DefineBudgetOfferService>(DefineBudgetOfferService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('define', () => {
    const mockArtistId = 'artist-123';
    const mockBudgetId = 'budget-456';
    const mockComments = 'Offer comments';
    const mockAvailability = AvailabilityStatus.HIGH;
    const mockPriceDto = {
      currency: 'USD',
      totalValue: 100,
      taxes: 10,
      originalValue: 90,
      possibleArtistComission: 5,
      possibleClientComission: 5,
      artistValue: 80,
      transactionalOperationCost: 2,
      platformOperationCost: 3,
      platformReceivedValue: 5,
      isArtistFreeTax: false,
    } as any;

    const mockOwner = {
      id: 'client-owner-789',
      stripeCustomer: 'cus_existing123',
    };

    const mockClient = {
      id: 'client-artist-321',
      username: 'artist_user',
    };

    const mockBudget = {
      id: mockBudgetId,
      owner: mockOwner,
      type: BudgetType.PRIVATE,
    };

    const mockArtist = {
      id: mockArtistId,
      client: mockClient,
    };

    it('should execute define successfully for private budget with existing stripe customer (Happy Path)', async () => {
      // Arrange
      budgetRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(mockBudget as any);
      artistRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(mockArtist as any);

      // Act
      await service.define(
        mockArtistId,
        mockBudgetId,
        mockComments,
        mockAvailability,
        mockPriceDto,
      );

      // Assert
      expect(stripeService.createCustomer).not.toHaveBeenCalled();
      expect(clientRepository.update).not.toHaveBeenCalled();

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { budget: { id: mockBudgetId }, artist: { id: mockArtistId } },
        { status: ApprovalStatus.CANCELED, statusChangedBy: mockClient },
      );

      expect(priceRepository.save).toHaveBeenCalled();
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: mockBudgetId },
        { price: expect.anything() },
      );
      expect(budgetOfferRepository.save).toHaveBeenCalled();
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: mockBudgetId },
        { status: BudgetStatus.BUDGET_OFFER },
      );
      expect(addBudgetChatMessageService.newChatMessage).toHaveBeenCalledWith(
        mockBudget,
        mockComments,
        mockClient,
        mockOwner,
        false,
        null,
        null,
        expect.anything(),
        null,
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockClient,
        mockOwner,
        BudgetNotificationType.NEW_PRICE,
      );
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        mockArtistId,
        mockOwner.id,
        mockBudgetId,
      );
    });

    it('should create stripe customer if owner does not have one', async () => {
      // Arrange
      const budgetWithoutStripe = {
        ...mockBudget,
        owner: { id: 'client-owner-789', stripeCustomer: null },
      };
      budgetRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(budgetWithoutStripe as any);
      artistRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(mockArtist as any);
      stripeService.createCustomer.mockResolvedValueOnce({ id: 'cus_new123' });

      // Act
      await service.define(
        mockArtistId,
        mockBudgetId,
        mockComments,
        mockAvailability,
        mockPriceDto,
      );

      // Assert
      expect(stripeService.createCustomer).toHaveBeenCalledWith(
        budgetWithoutStripe.owner,
      );
      expect(clientRepository.update).toHaveBeenCalledWith(
        { id: budgetWithoutStripe.owner.id },
        { stripeCustomer: 'cus_new123' },
      );
    });

    it('should update budget status to PUBLIC_BUDGET_OFFER when budget is PUBLIC', async () => {
      // Arrange
      const publicBudget = {
        ...mockBudget,
        type: BudgetType.PUBLIC,
      };
      budgetRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(publicBudget as any);
      artistRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(mockArtist as any);

      // Act
      await service.define(
        mockArtistId,
        mockBudgetId,
        mockComments,
        mockAvailability,
        mockPriceDto,
      );

      // Assert
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: mockBudgetId },
        { status: BudgetStatus.PUBLIC_BUDGET_OFFER },
      );
    });

    it('should throw exception when query builder or dependencies fail (Sad Path)', async () => {
      // Arrange
      budgetRepository
        .createQueryBuilder()
        .getOne.mockRejectedValueOnce(new Error('Database error'));

      // Act & Assert
      await expect(
        service.define(
          mockArtistId,
          mockBudgetId,
          mockComments,
          mockAvailability,
          mockPriceDto,
        ),
      ).rejects.toThrow('Database error');
    });
  });
});
