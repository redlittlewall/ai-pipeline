import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BudgetNotificationService } from './BudgetNotification.service';
import { BudgetNotifications } from 'model/budget/BudgetNotification.entity';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';

describe('BudgetNotificationService', () => {
  let service: BudgetNotificationService;
  let budgetNotificationsRepository: any;
  let notificationWokflow: any;

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
    budgetNotificationsRepository = createMockRepository();
    notificationWokflow = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetNotificationService,
        {
          provide: getRepositoryToken(BudgetNotifications),
          useValue: budgetNotificationsRepository,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWokflow,
        },
      ],
    }).compile();

    service = module.get<BudgetNotificationService>(BudgetNotificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('notify', () => {
    const mockBudget = { id: 'budget-1' } as any;
    const mockOwner = { id: 'owner-1', username: 'owner_user' } as any;
    const mockTarget = { id: 'target-1' } as any;

    it('should execute notify successfully and save notification (Happy Path)', async () => {
      // Given (Arrange)
      notificationWokflow.call.mockResolvedValueOnce(undefined);
      budgetNotificationsRepository.save.mockResolvedValueOnce({
        id: 'saved-id',
      } as any);

      // When (Act)
      await service.notify(
        mockBudget,
        mockOwner,
        mockTarget,
        BudgetNotificationType.NEW_BUDGET,
      );

      // Then (Assert)
      expect(notificationWokflow.call).toHaveBeenCalledWith(
        mockTarget.id,
        expect.objectContaining({
          senderClient: mockOwner,
          receiverClient: mockTarget,
          referencesBudget: mockBudget,
        }),
        true,
      );
      expect(budgetNotificationsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: mockBudget,
          owner: mockOwner,
          target: mockTarget,
          type: BudgetNotificationType.NEW_BUDGET,
        }),
      );
    });

    it('should catch and log error when notification workflow fails (Sad Path)', async () => {
      // Given (Arrange)
      const error = new Error('Workflow failed');
      notificationWokflow.call.mockRejectedValueOnce(error);
      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      // When (Act)
      await service.notify(
        mockBudget,
        mockOwner,
        mockTarget,
        BudgetNotificationType.NEW_BUDGET,
      );

      // Then (Assert)
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Erro ao tentar enviar mensagem para o usuario ${mockTarget.id}`,
        ),
        error,
      );
      expect(budgetNotificationsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getPushInfo', () => {
    const mockOwner = { username: 'john_doe' } as any;

    it('should return correct info for NEW_CHAT', () => {
      const [message, title] = service.getPushInfo(
        mockOwner,
        BudgetNotificationType.NEW_CHAT,
      );
      expect(title.pt).toBe('Nova mensagem');
      expect(message.pt).toContain(mockOwner.username);
    });

    it('should return correct info for NEW_BUDGET', () => {
      const [message, title] = service.getPushInfo(
        mockOwner,
        BudgetNotificationType.NEW_BUDGET,
      );
      expect(title.en).toBe('New budget');
      expect(message.en).toContain(mockOwner.username);
    });

    it('should return correct info for PRICE_APPROVED', () => {
      const [message, title] = service.getPushInfo(
        mockOwner,
        BudgetNotificationType.PRICE_APPROVED,
      );
      expect(title.pt).toBe('Orçamento aprovado');
      expect(message.pt).toContain(mockOwner.username);
    });

    it('should return correct info for PAYMENT_ERROR', () => {
      const [message, title] = service.getPushInfo(
        mockOwner,
        BudgetNotificationType.PAYMENT_ERROR,
      );
      expect(title.pt).toBe('Erro no pagamento');
      expect(message.en).toBe('An error occurred while paying for your offer');
    });

    it('should return correct info for NEW_APOINTMENT', () => {
      const [message, title] = service.getPushInfo(
        mockOwner,
        BudgetNotificationType.NEW_APOINTMENT,
      );
      expect(title.en).toBe('New Schedule');
      expect(message.pt).toBe(
        'Você recebeu uma nova tentativa de marcação de horário para um orçamento',
      );
    });

    it('should return correct info for PAYMENT_RECEIVED', () => {
      const [message, title] = service.getPushInfo(
        mockOwner,
        BudgetNotificationType.PAYMENT_RECEIVED,
      );
      expect(title.pt).toBe('Pagamento recebido');
      expect(message.pt).toBe('Recebemos seu pagamento com sucesso');
    });
  });
});
