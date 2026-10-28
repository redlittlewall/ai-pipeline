import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommentBudgetService } from './CommentBudget.Service';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { AddBudgetChatMessageService } from './chat/AddBudgetChatMessage.Service';
import { MediaTypeEnum } from 'enums/FileTypeEnum';

describe('CommentBudgetService', () => {
  let service: CommentBudgetService;
  let clientRepository: any;
  let budgetRepository: any;
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
    clientRepository = createMockRepository();
    budgetRepository = createMockRepository();
    addBudgetChatMessageService = {
      newChatMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentBudgetService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: AddBudgetChatMessageService,
          useValue: addBudgetChatMessageService,
        },
      ],
    }).compile();

    service = module.get<CommentBudgetService>(CommentBudgetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('comment', () => {
    it('should send chat message setting owner as target when clientId equals selectedArtist id', async () => {
      // Given (Arrange)
      const clientId = 'artist-id';
      const budgetId = 'budget-id';
      const comments = 'Great budget proposal!';
      const files = [{ originalname: 'file.png' }] as any[];
      const mediaType = MediaTypeEnum.IMAGE;

      const mockClient = { id: clientId, name: 'Artist Client' };
      const mockOwner = { id: 'owner-id', name: 'Owner User' };
      const mockArtistClient = { id: 'artist-client-user-id' };
      const mockBudget = {
        id: budgetId,
        selectedArtist: { id: clientId, client: mockArtistClient },
        owner: mockOwner,
      };

      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      addBudgetChatMessageService.newChatMessage.mockResolvedValueOnce(
        undefined as any,
      );

      // When (Act)
      await service.comment(clientId, budgetId, comments, files, mediaType);

      // Then (Assert)
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: clientId },
      });
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { id: budgetId },
        relations: ['selectedArtist', 'selectedArtist.client', 'owner'],
      });
      expect(addBudgetChatMessageService.newChatMessage).toHaveBeenCalledWith(
        mockBudget,
        comments,
        mockClient,
        mockOwner,
        true,
        files,
        mediaType,
        null,
        null,
      );
    });

    it('should send chat message setting selectedArtist.client as target when clientId does not equal selectedArtist id', async () => {
      // Given (Arrange)
      const clientId = 'owner-id';
      const budgetId = 'budget-id';
      const comments = 'Can we adjust the prices?';

      const mockClient = { id: clientId, name: 'Owner Client' };
      const mockOwner = { id: clientId, name: 'Owner Client' };
      const mockArtistClient = { id: 'artist-client-user-id' };
      const mockBudget = {
        id: budgetId,
        selectedArtist: { id: 'different-artist-id', client: mockArtistClient },
        owner: mockOwner,
      };

      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      addBudgetChatMessageService.newChatMessage.mockResolvedValueOnce(
        undefined as any,
      );

      // When (Act)
      await service.comment(clientId, budgetId, comments);

      // Then (Assert)
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: clientId },
      });
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { id: budgetId },
        relations: ['selectedArtist', 'selectedArtist.client', 'owner'],
      });
      expect(addBudgetChatMessageService.newChatMessage).toHaveBeenCalledWith(
        mockBudget,
        comments,
        mockClient,
        mockArtistClient,
        true,
        undefined,
        undefined,
        null,
        null,
      );
    });

    it('should propagate error when repository or chat service throws', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.comment('client-1', 'budget-1', 'comment text'),
      ).rejects.toThrow('Database error');
    });
  });
});
