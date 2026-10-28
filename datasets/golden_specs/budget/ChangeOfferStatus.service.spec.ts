import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChangeOfferStatusService } from './ChangeOfferStatus.service';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { BudgetNotificationService } from '../notification/BudgetNotification.service';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { BudgetChatSocketService } from '../chat/BudgetChatSocket.Service';
import { AddBudgetChatMessageService } from '../chat/AddBudgetChatMessage.Service';
import { GetBudgetChatMessagesService } from '../chat/GetBudgetChatMessages.Service';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { BudgetStatus } from 'enums/BudgetStatus';
import { BudgetType } from 'enums/BudgetType';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';
import { Not } from 'typeorm';

describe('ChangeOfferStatusService', () => {
  let service: ChangeOfferStatusService;
  let budgetOfferRepository: any;
  let clientRepository: any;
  let budgetRepository: any;
  let budgetNotificationService: any;
  let notificationWorkflow: any;
  let budgetChatSocketService: any;
  let addBudgetChatMessageService: any;
  let getBudgetChatMessagesService: any;

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
    clientRepository = createMockRepository();
    budgetRepository = createMockRepository();
    budgetNotificationService = {
      notify: jest.fn(),
    };
    notificationWorkflow = {
      call: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };
    addBudgetChatMessageService = {
      newChatMessage: jest.fn(),
    };
    getBudgetChatMessagesService = {
      getSpecificMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangeOfferStatusService,
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: BudgetNotificationService,
          useValue: budgetNotificationService,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
        {
          provide: AddBudgetChatMessageService,
          useValue: addBudgetChatMessageService,
        },
        {
          provide: GetBudgetChatMessagesService,
          useValue: getBudgetChatMessagesService,
        },
      ],
    }).compile();

    service = module.get<ChangeOfferStatusService>(ChangeOfferStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('process', () => {
    it('should return early if budget status is closed/finished/scheduled', async () => {
      const mockOffer = {
        id: 'offer-1',
        budget: { status: BudgetStatus.CLOSED },
      } as any;
      budgetOfferRepository.findOne.mockResolvedValueOnce(mockOffer);

      await service.process(
        'client-1',
        'offer-1',
        ApprovalStatus.APPROVED,
        'reason',
      );

      expect(budgetOfferRepository.update).not.toHaveBeenCalled();
    });

    it('should process artist canceling an offer', async () => {
      const mockClient = { id: 'artist-1' } as any;
      const mockOffer = {
        id: 'offer-1',
        artist: { id: 'artist-1' },
        budget: {
          id: 'budget-1',
          status: BudgetStatus.OPEN,
          owner: { id: 'owner-1' },
        },
      } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetOfferRepository.findOne.mockResolvedValueOnce(mockOffer);
      getBudgetChatMessagesService.getSpecificMessage.mockResolvedValueOnce({
        id: 'msg-1',
      } as any);

      await service.process(
        'artist-1',
        'offer-1',
        ApprovalStatus.CANCELED,
        'no more time',
      );

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { id: 'offer-1' },
        expect.objectContaining({ status: ApprovalStatus.CANCELED }),
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockOffer.budget,
        mockClient,
        mockOffer.budget.owner,
        BudgetNotificationType.PRICE_CANCELLED,
      );
    });

    it('should process owner approving an offer', async () => {
      const mockClient = { id: 'owner-1' } as any;
      const mockArtist = { id: 'artist-1' } as any;
      const mockOffer = {
        id: 'offer-1',
        artist: mockArtist,
        budget: {
          id: 'budget-1',
          status: BudgetStatus.OPEN,
          owner: mockClient,
          type: BudgetType.PRIVATE,
        },
      } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetOfferRepository.findOne.mockResolvedValueOnce(mockOffer);
      budgetOfferRepository.findOne.mockResolvedValueOnce(mockOffer); // inside approve logic if needed

      await service.process(
        'owner-1',
        'offer-1',
        ApprovalStatus.APPROVED,
        null,
      );

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'budget-1' },
        expect.objectContaining({ status: BudgetStatus.PAYMENT_PENDING }),
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockOffer.budget,
        mockClient,
        mockArtist,
        BudgetNotificationType.PRICE_APPROVED,
      );
    });
  });

  describe('_approveBudgetOffer', () => {
    it('should update offer status and budget status for private budget', async () => {
      const currentUser = { id: 'u1' } as any;
      const offer = {
        id: 'o1',
        artist: { id: 'a1' },
        budget: { id: 'b1', type: BudgetType.PRIVATE },
      } as any;
      const otherClient = { id: 'a1' } as any;

      await service._approveBudgetOffer(currentUser, offer, otherClient);

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { id: 'o1' },
        { status: ApprovalStatus.APPROVED, statusChangedBy: currentUser },
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b1' },
        expect.objectContaining({ status: BudgetStatus.PAYMENT_PENDING }),
      );
    });

    it('should handle public budget and update artist budget number', async () => {
      const currentUser = { id: 'u1' } as any;
      const offer = {
        id: 'o1',
        artist: { id: 'a1' },
        budget: { id: 'b1', type: BudgetType.PUBLIC },
      } as any;

      budgetRepository.findOne.mockResolvedValueOnce({
        artistBudgetNumber: 5,
      } as any);
      budgetOfferRepository.find.mockResolvedValueOnce([]); // for notifyNotChosen

      await service._approveBudgetOffer(currentUser, offer, {
        id: 'a1',
      } as any);

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b1' },
        expect.objectContaining({ artistBudgetNumber: 6 }),
      );
    });
  });

  describe('_denyOffer', () => {
    it('should update offer as reproved and set budget back to open for private budget', async () => {
      const offer = {
        id: 'o1',
        budget: { id: 'b1', type: BudgetType.PRIVATE },
      } as any;

      await service._denyOffer({} as any, offer, 'too expensive', {} as any);

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { id: 'o1' },
        expect.objectContaining({
          status: ApprovalStatus.REPROVED,
          statusComment: 'too expensive',
        }),
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b1' },
        { status: BudgetStatus.OPEN },
      );
    });

    it('should set status to PUBLIC_BUDGET_OFFER if more pending offers exist in public budget', async () => {
      const offer = {
        id: 'o1',
        budget: { id: 'b1', type: BudgetType.PUBLIC },
      } as any;
      budgetOfferRepository.count.mockResolvedValueOnce(1);

      await service._denyOffer({} as any, offer, 'reason', {} as any);

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b1' },
        { status: BudgetStatus.PUBLIC_BUDGET_OFFER },
      );
    });
  });

  describe('_cancelOffer', () => {
    it('should update offer as canceled and update budget status based on remaining offers', async () => {
      const offer = {
        id: 'o1',
        budget: { id: 'b1', type: BudgetType.PRIVATE },
      } as any;
      budgetOfferRepository.count.mockResolvedValueOnce(0);

      await service._cancelOffer(
        { id: 'u1' } as any,
        offer,
        'cancel',
        {} as any,
      );

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { id: 'o1' },
        expect.objectContaining({ status: ApprovalStatus.CANCELED }),
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'b1' },
        { status: BudgetStatus.OPEN },
      );
    });
  });

  describe('_notifyNotChosen', () => {
    it('should notify other artists when one is chosen', async () => {
      const offer = {
        id: 'o1',
        artist: { id: 'a1' },
        budget: { id: 'b1' },
      } as any;
      const otherOffer = {
        id: 'o2',
        artist: { id: 'a2', client: { id: 'c2' } },
      } as any;
      const otherClient = { username: 'user1' } as any;

      budgetOfferRepository.find.mockResolvedValueOnce([otherOffer] as any);

      await service._notifyNotChosen(offer, otherClient);

      expect(budgetOfferRepository.update).toHaveBeenCalledWith(
        { id: 'o2' },
        { status: ApprovalStatus.CANCELED },
      );
      expect(notificationWorkflow.call).toHaveBeenCalled();
    });
  });
});
