import { Test, TestingModule } from '@nestjs/testing';
import { BudgetChatSocketService } from './BudgetChatSocket.Service';
import { SocketGateWay } from 'modules/sockets/Socket.Gateway';
import { FindUserSocketByConfigurationsService } from 'modules/sockets/FindUserSocketByConfigurations.Serivce';
import { GetBudgetsService } from '../GetBudgets.service';
import { NotificationType } from 'enums/NotificationType';

describe('BudgetChatSocketService', () => {
  let service: BudgetChatSocketService;
  let socketGateway: any;
  let findUserSocketByConfigurationsService: any;
  let getBudgetsService: any;

  beforeEach(async () => {
    socketGateway = {
      sendEvent: jest.fn(),
    };
    findUserSocketByConfigurationsService = {
      find: jest.fn(),
    };
    getBudgetsService = {
      getBudgetById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetChatSocketService,
        {
          provide: SocketGateWay,
          useValue: socketGateway,
        },
        {
          provide: FindUserSocketByConfigurationsService,
          useValue: findUserSocketByConfigurationsService,
        },
        {
          provide: GetBudgetsService,
          useValue: getBudgetsService,
        },
      ],
    }).compile();

    service = module.get<BudgetChatSocketService>(BudgetChatSocketService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessage', () => {
    it('should process chat message and send events to user and target sockets (Happy Path)', async () => {
      // Arrange
      const userId = 'user-123';
      const targetId = 'target-456';
      const mockChatMessage = { id: 'msg-1', message: 'Hello' } as any;
      const mockUserSocket = { socketId: 'socket-user-123' } as any;
      const mockTargetSocket = { socketId: 'socket-target-456' } as any;

      findUserSocketByConfigurationsService.find
        .mockResolvedValueOnce(mockUserSocket)
        .mockResolvedValueOnce(mockTargetSocket);

      // Act
      await service.processMessage(userId, targetId, mockChatMessage);

      // Assert
      expect(
        findUserSocketByConfigurationsService.find,
      ).toHaveBeenNthCalledWith(1, userId, NotificationType.BUDGET, false);
      expect(
        findUserSocketByConfigurationsService.find,
      ).toHaveBeenNthCalledWith(2, targetId, NotificationType.BUDGET, false);
      expect(socketGateway.sendEvent).toHaveBeenNthCalledWith(
        1,
        'socket-user-123',
        'chatMessageChange',
        mockChatMessage,
      );
      expect(socketGateway.sendEvent).toHaveBeenNthCalledWith(
        2,
        'socket-target-456',
        'chatMessageChange',
        mockChatMessage,
      );
    });

    it('should propagate errors when socket finding fails', async () => {
      // Arrange
      findUserSocketByConfigurationsService.find.mockRejectedValueOnce(
        new Error('Socket service error'),
      );

      // Act & Assert
      await expect(
        service.processMessage('user-123', 'target-456', {} as any),
      ).rejects.toThrow('Socket service error');
    });
  });

  describe('updateBudget', () => {
    it('should update budget for both owner and target when targetId is provided (Happy Path)', async () => {
      // Arrange
      const userId = 'user-1';
      const targetId = 'target-2';
      const budgetId = 'budget-100';

      const mockOwnerBudget = { id: budgetId, title: 'Owner Budget' } as any;
      const mockTargetBudget = { id: budgetId, title: 'Target Budget' } as any;
      const mockUserSocket = { socketId: 'socket-user-1' } as any;
      const mockTargetSocket = { socketId: 'socket-target-2' } as any;

      getBudgetsService.getBudgetById
        .mockResolvedValueOnce(mockOwnerBudget)
        .mockResolvedValueOnce(mockTargetBudget);

      findUserSocketByConfigurationsService.find
        .mockResolvedValueOnce(mockUserSocket)
        .mockResolvedValueOnce(mockTargetSocket);

      // Act
      await service.updateBudget(userId, targetId, budgetId);

      // Assert
      expect(getBudgetsService.getBudgetById).toHaveBeenNthCalledWith(
        1,
        userId,
        budgetId,
        false,
        false,
      );
      expect(
        findUserSocketByConfigurationsService.find,
      ).toHaveBeenNthCalledWith(1, userId, NotificationType.BUDGET, false);
      expect(socketGateway.sendEvent).toHaveBeenNthCalledWith(
        1,
        'socket-user-1',
        'budgetChange',
        mockOwnerBudget,
      );

      expect(getBudgetsService.getBudgetById).toHaveBeenNthCalledWith(
        2,
        targetId,
        budgetId,
        false,
        false,
      );
      expect(
        findUserSocketByConfigurationsService.find,
      ).toHaveBeenNthCalledWith(2, targetId, NotificationType.BUDGET, false);
      expect(socketGateway.sendEvent).toHaveBeenNthCalledWith(
        2,
        'socket-target-2',
        'budgetChange',
        mockTargetBudget,
      );
    });

    it('should update budget for owner only when targetId is null or undefined (Conditional Branch)', async () => {
      // Arrange
      const userId = 'user-1';
      const targetId = null as any;
      const budgetId = 'budget-100';

      const mockOwnerBudget = { id: budgetId, title: 'Owner Budget' } as any;
      const mockUserSocket = { socketId: 'socket-user-1' } as any;

      getBudgetsService.getBudgetById.mockResolvedValueOnce(mockOwnerBudget);
      findUserSocketByConfigurationsService.find.mockResolvedValueOnce(
        mockUserSocket,
      );

      // Act
      await service.updateBudget(userId, targetId, budgetId);

      // Assert
      expect(getBudgetsService.getBudgetById).toHaveBeenCalledTimes(1);
      expect(getBudgetsService.getBudgetById).toHaveBeenCalledWith(
        userId,
        budgetId,
        false,
        false,
      );
      expect(findUserSocketByConfigurationsService.find).toHaveBeenCalledTimes(
        1,
      );
      expect(socketGateway.sendEvent).toHaveBeenCalledTimes(1);
      expect(socketGateway.sendEvent).toHaveBeenCalledWith(
        'socket-user-1',
        'budgetChange',
        mockOwnerBudget,
      );
    });

    it('should propagate error when getBudgetById throws exception (Sad Path)', async () => {
      // Arrange
      getBudgetsService.getBudgetById.mockRejectedValueOnce(
        new Error('Budget not found'),
      );

      // Act & Assert
      await expect(
        service.updateBudget('user-1', 'target-2', 'invalid-budget-id'),
      ).rejects.toThrow('Budget not found');
    });
  });
});
