import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TryScheduleBudgetService } from './TryScheduleBudget.Service';
import { BudgetSchedule } from 'model/budget/BudgetSchedule.entity';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { BudgetNotificationService } from '../notification/BudgetNotification.service';
import { AddBudgetChatMessageService } from '../chat/AddBudgetChatMessage.Service';
import { BudgetChatSocketService } from '../chat/BudgetChatSocket.Service';
import { BudgetStatus } from 'enums/BudgetStatus';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';
import { Not } from 'typeorm';

describe('TryScheduleBudgetService', () => {
  let service: TryScheduleBudgetService;
  let budgetScheduleRepository: any;
  let clientRepository: any;
  let budgetRepository: any;
  let budgetNotificationService: any;
  let addBudgetChatMessageService: any;
  let budgetChatSocketService: any;

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
    budgetScheduleRepository = createMockRepository();
    clientRepository = createMockRepository();
    budgetRepository = createMockRepository();
    budgetNotificationService = {
      notify: jest.fn(),
    };
    addBudgetChatMessageService = {
      newChatMessage: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TryScheduleBudgetService,
        {
          provide: getRepositoryToken(BudgetSchedule),
          useValue: budgetScheduleRepository,
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
          provide: AddBudgetChatMessageService,
          useValue: addBudgetChatMessageService,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
      ],
    }).compile();

    service = module.get<TryScheduleBudgetService>(TryScheduleBudgetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('process', () => {
    const clientId = 'client-1';
    const budgetId = 'budget-1';
    const date = '2023-10-27T10:00:00Z';

    const mockClient = { id: clientId } as any;
    const mockArtist = {
      id: 'artist-1',
      client: { id: 'artist-client-id' },
    } as any;
    const mockOwner = { id: 'owner-1' } as any;
    const mockBudget = {
      id: budgetId,
      selectedArtist: mockArtist,
      owner: mockOwner,
    } as any;

    it('should schedule budget and notify owner when requested by artist (Happy Path)', async () => {
      // Given
      const artistClientId = 'artist-client-id';
      const mockArtistClient = { id: artistClientId } as any;
      const mockArtistWithRelation = {
        id: artistClientId,
        client: mockArtistClient,
      } as any;
      const mockOwnerWithRelation = { id: 'owner-1' } as any;
      const mockBudgetWithRelations = {
        id: budgetId,
        selectedArtist: mockArtistWithRelation,
        owner: mockOwnerWithRelation,
      } as any;

      clientRepository.findOne.mockResolvedValueOnce(mockArtistClient);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudgetWithRelations);

      // When
      const result = await service.process(artistClientId, budgetId, date);

      // Then
      expect(budgetScheduleRepository.save).toHaveBeenCalled();
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: budgetId },
        { status: BudgetStatus.SCHEDULE_OFFER },
      );
      expect(budgetScheduleRepository.update).toHaveBeenCalledWith(
        {
          id: expect.anything(),
          requestedBy: { id: artistClientId },
          budget: { id: budgetId },
        },
        { status: ApprovalStatus.CANCELED, statusChangedBy: mockArtistClient },
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudgetWithRelations,
        mockArtistClient,
        mockOwnerWithRelation,
        BudgetNotificationType.NEW_APOINTMENT,
      );
      expect(addBudgetChatMessageService.newChatMessage).toHaveBeenCalled();
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        artistClientId,
        mockOwnerWithRelation.id,
        budgetId,
      );
      expect(result).toBeDefined();
    });

    it('should schedule budget and notify artist when requested by client (Conditional Path)', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget);

      // When
      await service.process(clientId, budgetId, date);

      // Then
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockClient,
        mockArtist,
        BudgetNotificationType.NEW_APOINTMENT,
      );
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        clientId,
        mockArtist.id,
        budgetId,
      );
    });

    it('should propagate error if client is not found (Sad Path)', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When & Then
      await expect(service.process(clientId, budgetId, date)).rejects.toThrow();
    });

    it('should propagate error if budget repository update fails (Sad Path)', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget);
      budgetRepository.update.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then
      await expect(service.process(clientId, budgetId, date)).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
