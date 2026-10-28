import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReplyBudgetScheduleService } from './ReplyBudgetSchedule.Service';
import { BudgetSchedule } from 'model/budget/BudgetSchedule.entity';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { BudgetNotificationService } from '../notification/BudgetNotification.service';
import { BudgetChatSocketService } from '../chat/BudgetChatSocket.Service';
import { AddBudgetChatMessageService } from '../chat/AddBudgetChatMessage.Service';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { BudgetStatus } from 'enums/BudgetStatus';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';
import { BadRequestException } from '@nestjs/common';
import { Not } from 'typeorm';

describe('ReplyBudgetScheduleService', () => {
  let service: ReplyBudgetScheduleService;
  let budgetScheduleRepository: any;
  let clientRepository: any;
  let budgetRepository: any;
  let budgetNotificationService: any;
  let budgetChatSocketService: any;
  let addBudgetChatMessageService: any;

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
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };
    addBudgetChatMessageService = {
      newChatMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplyBudgetScheduleService,
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
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
        {
          provide: AddBudgetChatMessageService,
          useValue: addBudgetChatMessageService,
        },
      ],
    }).compile();

    service = module.get<ReplyBudgetScheduleService>(
      ReplyBudgetScheduleService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('repply', () => {
    const clientId = 'client-123';
    const artistId = 'artist-456';
    const scheduleId = 'schedule-789';
    const budgetId = 'budget-000';

    const mockClient = { id: clientId } as any;
    const mockArtist = { id: artistId } as any;
    const mockBudget = {
      id: budgetId,
      owner: { id: 'owner-1' },
      selectedArtist: mockArtist,
    } as any;
    const mockSchedule = {
      id: scheduleId,
      budget: mockBudget,
      requestedBy: { id: artistId },
    } as any;

    it('should throw BadRequestException if requester tries to approve/reprove their own schedule', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetScheduleRepository.findOne.mockResolvedValueOnce({
        ...mockSchedule,
        requestedBy: { id: clientId },
      } as any);

      // When & Then
      await expect(
        service.repply(clientId, scheduleId, ApprovalStatus.APPROVED, 'Nice'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should approve schedule, cancel others and update budget status to SCHEDULED', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetScheduleRepository.findOne.mockResolvedValueOnce(mockSchedule);

      // When
      await service.repply(
        clientId,
        scheduleId,
        ApprovalStatus.APPROVED,
        'Approved!',
      );

      // Then
      expect(budgetScheduleRepository.update).toHaveBeenCalledWith(
        { id: scheduleId },
        expect.objectContaining({ status: ApprovalStatus.APPROVED }),
      );
      expect(budgetScheduleRepository.update).toHaveBeenCalledWith(
        {
          budget: { id: budgetId },
          id: Not(scheduleId),
          status: Not(ApprovalStatus.APPROVED),
        },
        expect.objectContaining({ status: ApprovalStatus.CANCELED }),
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: budgetId },
        { status: BudgetStatus.SCHEDULED, approvedSchedule: mockSchedule },
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockClient,
        mockArtist,
        BudgetNotificationType.APOINTMENT_APPROVED,
      );
    });

    it('should reprove schedule and update budget status to SCHEDULE_PENDING', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetScheduleRepository.findOne.mockResolvedValueOnce(mockSchedule);

      // When
      await service.repply(
        clientId,
        scheduleId,
        ApprovalStatus.REPROVED,
        'No way',
      );

      // Then
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: budgetId },
        { status: BudgetStatus.SCHEDULE_PENDING },
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockClient,
        mockArtist,
        BudgetNotificationType.APOINTMENT_DENIED,
      );
    });

    it('should cancel schedule even if requester is the one calling repply', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetScheduleRepository.findOne.mockResolvedValueOnce({
        ...mockSchedule,
        requestedBy: { id: clientId },
      } as any);

      // When
      await service.repply(
        clientId,
        scheduleId,
        ApprovalStatus.CANCELED,
        'Cancel',
      );

      // Then
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: budgetId },
        { status: BudgetStatus.SCHEDULE_PENDING },
      );
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        expect.anything(),
        mockClient,
        expect.anything(),
        BudgetNotificationType.APOINTMENT_CANCELLED,
      );
    });

    it('should send chat message if approvalComment is provided', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetScheduleRepository.findOne.mockResolvedValueOnce(mockSchedule);
      const comment = 'See you there';

      // When
      await service.repply(
        clientId,
        scheduleId,
        ApprovalStatus.APPROVED,
        comment,
      );

      // Then
      expect(addBudgetChatMessageService.newChatMessage).toHaveBeenCalledWith(
        mockBudget,
        comment,
        mockClient,
        mockArtist,
        false,
        null,
        null,
        null,
        null,
      );
    });

    it('should update budget socket at the end', async () => {
      // Given
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      budgetScheduleRepository.findOne.mockResolvedValueOnce(mockSchedule);

      // When
      await service.repply(clientId, scheduleId, ApprovalStatus.APPROVED, '');

      // Then
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        clientId,
        artistId,
        budgetId,
      );
    });
  });
});
