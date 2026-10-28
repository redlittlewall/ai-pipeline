import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetBudgetChatMessagesService } from './GetBudgetChatMessages.Service';
import { BudgetChatMessage } from 'model/budget/BudgetChatMessage.entity';
import { ChatMessageToDtoService } from './ChatMessageToDto.Service';

describe('GetBudgetChatMessagesService', () => {
  let service: GetBudgetChatMessagesService;
  let budgetChatMessageRepository: any;
  let chatMessageToDtoService: any;

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
    budgetChatMessageRepository = createMockRepository();
    chatMessageToDtoService = {
      toDto: jest.fn(),
      toDtoList: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetBudgetChatMessagesService,
        {
          provide: getRepositoryToken(BudgetChatMessage),
          useValue: budgetChatMessageRepository,
        },
        {
          provide: ChatMessageToDtoService,
          useValue: chatMessageToDtoService,
        },
      ],
    }).compile();

    service = module.get<GetBudgetChatMessagesService>(
      GetBudgetChatMessagesService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSpecificMessage', () => {
    it('should return a specific message converted to DTO', async () => {
      // Given (Arrange)
      const mockMessage = { id: 'msg-1' } as any;
      const mockDto = { id: 'msg-1', content: 'hello' } as any;
      budgetChatMessageRepository.findOne.mockResolvedValueOnce(mockMessage);
      chatMessageToDtoService.toDto.mockReturnValueOnce(mockDto);

      // When (Act)
      const result = await service.getSpecificMessage(
        'user-1',
        'offer-1',
        'budget-1',
      );

      // Then (Assert)
      expect(budgetChatMessageRepository.findOne).toHaveBeenCalledWith({
        where: { offer: { id: 'offer-1' } },
        relations: service.relations,
      });
      expect(chatMessageToDtoService.toDto).toHaveBeenCalledWith(
        'user-1',
        'budget-1',
        mockMessage,
      );
      expect(result).toEqual(mockDto);
    });

    it('should return null if no message is found', async () => {
      // Given (Arrange)
      budgetChatMessageRepository.findOne.mockResolvedValueOnce(null);
      chatMessageToDtoService.toDto.mockReturnValueOnce(null);

      // When (Act)
      const result = await service.getSpecificMessage(
        'user-1',
        'offer-1',
        'budget-1',
      );

      // Then (Assert)
      expect(result).toBeNull();
    });

    it('should propagate errors when repository fails', async () => {
      // Given (Arrange)
      budgetChatMessageRepository.findOne.mockRejectedValueOnce(
        new Error('DB Error'),
      );

      // When & Then (Act & Assert)
      await expect(service.getSpecificMessage('u', 'o', 'b')).rejects.toThrow(
        'DB Error',
      );
    });
  });

  describe('getChatMessages', () => {
    it('should update unvisualized messages and return paginated DTO list', async () => {
      // Given (Arrange)
      const mockMessages = [{ id: '1' }, { id: '2' }] as any;
      const mockDtos = [{ id: '1' }, { id: '2' }] as any;
      budgetChatMessageRepository.find.mockResolvedValueOnce(mockMessages);
      chatMessageToDtoService.toDtoList.mockReturnValueOnce(mockDtos);

      // When (Act)
      const result = await service.getChatMessages('user-1', 'budget-1', 2);

      // Then (Assert)
      expect(budgetChatMessageRepository.update).toHaveBeenCalledWith(
        {
          budget: { id: 'budget-1' },
          target: { id: 'user-1' },
          vizualized: false,
        },
        { vizualized: true },
      );
      expect(budgetChatMessageRepository.find).toHaveBeenCalledWith({
        where: { budget: { id: 'budget-1' } },
        relations: service.relations,
        take: 10,
        skip: 20,
        order: { createdAt: 'DESC' },
      });
      expect(chatMessageToDtoService.toDtoList).toHaveBeenCalledWith(
        'user-1',
        'budget-1',
        mockMessages,
      );
      expect(result).toEqual(mockDtos);
    });

    it('should return empty array when no messages exist', async () => {
      // Given (Arrange)
      budgetChatMessageRepository.find.mockResolvedValueOnce([]);
      chatMessageToDtoService.toDtoList.mockReturnValueOnce([]);

      // When (Act)
      const result = await service.getChatMessages('user-1', 'budget-1', 0);

      // Then (Assert)
      expect(result).toEqual([]);
    });

    it('should propagate errors when update fails', async () => {
      // Given (Arrange)
      budgetChatMessageRepository.update.mockRejectedValueOnce(
        new Error('Update Failed'),
      );

      // When & Then (Act & Assert)
      await expect(service.getChatMessages('u', 'b', 0)).rejects.toThrow(
        'Update Failed',
      );
    });
  });
});
