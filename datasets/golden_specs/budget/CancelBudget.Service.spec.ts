import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { CancelBudgetService } from './CancelBudget.Service';
import { Budget } from 'model/budget/Budget.entity';
import { Client } from 'model/users/Client.entity';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { AddBudgetChatMessageService } from './chat/AddBudgetChatMessage.Service';
import { BudgetChatSocketService } from './chat/BudgetChatSocket.Service';
import { StripeService } from 'modules/payment/stripe/StripeService';
import { HandleRefoundPaymentService } from 'modules/payment/actions/HandleRefoundPayment.service';
import { BudgetType } from 'enums/BudgetType';
import { BudgetStatus } from 'enums/BudgetStatus';
import { ApprovalStatus } from 'enums/ApprovalStatus';

describe('CancelBudgetService', () => {
  let service: CancelBudgetService;
  let budgetRepository: any;
  let clientRepository: any;
  let budgetOfferRepository: any;
  let notificationWorkflow: any;
  let addBudgetChatMessageService: any;
  let budgetChatSocketService: any;
  let stripeService: any;
  let handleRefoundPaymentService: any;

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
    budgetOfferRepository = createMockRepository();
    notificationWorkflow = {
      call: jest.fn(),
    };
    addBudgetChatMessageService = {
      newChatMessage: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };
    stripeService = {
      cancelPaymentIntent: jest.fn(),
    };
    handleRefoundPaymentService = {
      handle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancelBudgetService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
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
        {
          provide: HandleRefoundPaymentService,
          useValue: handleRefoundPaymentService,
        },
      ],
    }).compile();

    service = module.get<CancelBudgetService>(CancelBudgetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cancel', () => {
    it('should delegate to cancelPublicBudget when budget type is PUBLIC and requester is owner', async () => {
      const mockOwner = { id: 'client-owner' };
      const mockBudget = {
        id: 'b-1',
        type: BudgetType.PUBLIC,
        owner: mockOwner,
      };
      const mockRequesterClient = { id: 'client-owner', username: 'ownerUser' };

      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      clientRepository.findOne.mockResolvedValueOnce(
        mockRequesterClient as any,
      );
      budgetOfferRepository.find.mockResolvedValueOnce([]);

      await service.cancel('client-owner', 'b-1', 'no reason');

      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        relations: ['owner', 'selectedArtist', 'approvedOffer'],
      });
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-owner' },
      });
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b-1' },
        { status: BudgetStatus.CLOSED, cancelledBy: mockRequesterClient },
      );
    });

    it('should return early without doing anything when budget type is PUBLIC and requester is NOT owner', async () => {
      const mockOwner = { id: 'client-owner' };
      const mockBudget = {
        id: 'b-1',
        type: BudgetType.PUBLIC,
        owner: mockOwner,
      };

      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);

      await service.cancel('not-owner', 'b-1', 'reason');

      expect(clientRepository.findOne).not.toHaveBeenCalled();
      expect(budgetRepository.update).not.toHaveBeenCalled();
    });

    it('should delegate to cancelPrivateBudget when budget type is PRIVATE', async () => {
      const mockOwner = { id: 'client-owner' };
      const mockArtistClient = { id: 'artist-client-id' };
      const mockBudget = {
        id: 'b-2',
        type: BudgetType.PRIVATE,
        owner: mockOwner,
        selectedArtist: mockArtistClient,
        approvedOffer: { price: {} },
      };
      const mockRequesterClient = { id: 'client-owner', username: 'ownerUser' };

      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      clientRepository.findOne.mockResolvedValueOnce(
        mockRequesterClient as any,
      );

      await service.cancel('client-owner', 'b-2', 'cancel reason');

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b-2' },
        { status: BudgetStatus.CLOSED, cancelledBy: mockRequesterClient },
      );
    });
  });

  describe('cancelPublicBudget', () => {
    it('should throw ForbiddenException if user is not the owner', async () => {
      const mockBudget = { id: 'b-1' } as any;
      const mockClient = { id: 'client-1' } as any;

      await expect(
        service.cancelPublicBudget(mockBudget, mockClient, false, 'reason'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should cancel all offers, update budget status to CLOSED and notify socket when user is owner', async () => {
      const mockBudget = { id: 'b-1' } as any;
      const mockRequesterClient = {
        id: 'client-owner',
        username: 'ownerUser',
      } as any;
      const mockOffers = [
        {
          id: 'offer-1',
          artist: { id: 'artist-1', client: { id: 'artist-client-1' } },
        },
        {
          id: 'offer-2',
          artist: { id: 'artist-2', client: { id: 'artist-client-2' } },
        },
      ] as any;

      budgetOfferRepository.find.mockResolvedValueOnce(mockOffers);

      await service.cancelPublicBudget(
        mockBudget,
        mockRequesterClient,
        true,
        'reason cancellation',
      );

      expect(budgetOfferRepository.find).toHaveBeenCalledWith({
        where: { budget: { id: 'b-1' } },
        relations: ['artist', 'artist.client'],
      });
      expect(budgetOfferRepository.update).toHaveBeenCalledTimes(2);
      expect(notificationWorkflow.call).toHaveBeenCalledTimes(2);
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b-1' },
        { status: BudgetStatus.CLOSED, cancelledBy: mockRequesterClient },
      );
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        'client-owner',
        null,
        'b-1',
      );
    });
  });

  describe('_cancelArtistOfferBudget', () => {
    it('should update offer status and call notificationWorkflow', async () => {
      const mockBudget = { id: 'b-1' } as any;
      const mockOffer = {
        id: 'offer-1',
        artist: { id: 'artist-1', client: { id: 'artist-client-1' } },
      } as any;
      const mockRequesterClient = {
        id: 'client-1',
        username: 'username1',
      } as any;

      await service._cancelArtistOfferBudget(
        mockBudget,
        mockOffer,
        mockRequesterClient,
        'some reason',
      );

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { id: 'offer-1' },
        {
          status: ApprovalStatus.CANCELED,
          statusChangedBy: mockRequesterClient,
          statusComment: 'some reason',
        },
      );
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        'artist-1',
        expect.objectContaining({
          type: 'BUDGET',
          senderClient: mockRequesterClient,
          receiverClient: mockOffer.artist.client,
          referencesBudget: mockBudget,
        }),
        true,
      );
    });
  });

  describe('cancelPrivateBudget', () => {
    it('should throw ForbiddenException if requester is neither selectedArtist nor owner', async () => {
      const mockBudget = {
        id: 'b-1',
        owner: { id: 'owner-id' },
        selectedArtist: { id: 'artist-client-id' },
      } as any;
      const mockRequesterClient = { id: 'third-party-id' } as any;

      await expect(
        service.cancelPrivateBudget(
          mockBudget,
          mockRequesterClient,
          false,
          'reason',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should cancel private budget when requested by artist, creating chat message and notifying other client', async () => {
      const mockOwner = { id: 'owner-id' };
      const mockArtistClient = { id: 'artist-client-id' };
      const mockBudget = {
        id: 'b-private',
        owner: mockOwner,
        selectedArtist: mockArtistClient,
        approvedOffer: {
          price: {},
        },
      } as any;

      await service.cancelPrivateBudget(
        mockBudget,
        mockArtistClient as any,
        false,
        'reason for canceling',
      );

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { budget: { id: 'b-private' }, artist: { id: 'artist-client-id' } },
        { status: ApprovalStatus.CANCELED, statusChangedBy: mockArtistClient },
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b-private' },
        { status: BudgetStatus.CLOSED, cancelledBy: mockArtistClient },
      );
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        'owner-id',
        expect.anything(),
        true,
      );
      expect(addBudgetChatMessageService.newChatMessage).toHaveBeenCalledWith(
        mockBudget,
        'reason for canceling',
        mockArtistClient,
        mockOwner,
        false,
        null,
        null,
        null,
        null,
      );
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        'artist-client-id',
        'owner-id',
        'b-private',
      );
    });

    it('should not send chat message when reason is null', async () => {
      const mockOwner = { id: 'owner-id' };
      const mockArtistClient = { id: 'artist-client-id' };
      const mockBudget = {
        id: 'b-private',
        owner: mockOwner,
        selectedArtist: mockArtistClient,
        approvedOffer: { price: {} },
      } as any;

      await service.cancelPrivateBudget(
        mockBudget,
        mockOwner as any,
        true,
        null,
      );

      expect(addBudgetChatMessageService.newChatMessage).not.toHaveBeenCalled();
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        'owner-id',
        'artist-client-id',
        'b-private',
      );
    });

    it('should call handleRefoundPaymentService when payment is received and status is not FINISHED/REFOUNDED', async () => {
      const mockOwner = { id: 'owner-id' };
      const mockArtistClient = { id: 'artist-client-id' };
      const mockBudget = {
        id: 'b-paid',
        status: BudgetStatus.OPEN,
        owner: mockOwner,
        selectedArtist: mockArtistClient,
        approvedOffer: {
          price: {
            stripePaymentIntentId: 'pi_12345',
            received: true,
          },
        },
      } as any;

      await service.cancelPrivateBudget(
        mockBudget,
        mockOwner as any,
        true,
        'refound needed',
      );

      expect(handleRefoundPaymentService.handle).toHaveBeenCalledWith(
        'owner-id',
        'b-paid',
        'refound needed',
      );
      expect(stripeService.cancelPaymentIntent).not.toHaveBeenCalled();
    });

    it('should cancel payment intent via stripeService when payment intent exists but received is false', async () => {
      const mockOwner = { id: 'owner-id' };
      const mockArtistClient = { id: 'artist-client-id' };
      const mockBudget = {
        id: 'b-pending-payment',
        status: BudgetStatus.OPEN,
        owner: mockOwner,
        selectedArtist: mockArtistClient,
        approvedOffer: {
          price: {
            stripePaymentIntentId: 'pi_67890',
            received: false,
          },
        },
      } as any;

      await service.cancelPrivateBudget(
        mockBudget,
        mockOwner as any,
        true,
        'cancel intent',
      );

      expect(stripeService.cancelPaymentIntent).toHaveBeenCalledWith(
        'pi_67890',
      );
      expect(handleRefoundPaymentService.handle).not.toHaveBeenCalled();
    });

    it('should cancel payment intent via stripeService when status is FINISHED even if received is true', async () => {
      const mockOwner = { id: 'owner-id' };
      const mockArtistClient = { id: 'artist-client-id' };
      const mockBudget = {
        id: 'b-finished',
        status: BudgetStatus.FINISHED,
        owner: mockOwner,
        selectedArtist: mockArtistClient,
        approvedOffer: {
          price: {
            stripePaymentIntentId: 'pi_finished',
            received: true,
          },
        },
      } as any;

      await service.cancelPrivateBudget(
        mockBudget,
        mockOwner as any,
        true,
        'cancel finished budget',
      );

      expect(stripeService.cancelPaymentIntent).toHaveBeenCalledWith(
        'pi_finished',
      );
      expect(handleRefoundPaymentService.handle).not.toHaveBeenCalled();
    });
  });
});
