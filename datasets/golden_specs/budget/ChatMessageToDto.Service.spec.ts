import { Test, TestingModule } from '@nestjs/testing';
import { ChatMessageToDtoService } from './ChatMessageToDto.Service';
import { MediaService } from 'modules/media/media.service';
import { ClientService } from 'modules/users/Client.Service';

describe('ChatMessageToDtoService', () => {
  let service: ChatMessageToDtoService;
  let mediaService: any;
  let clientService: any;

  beforeEach(async () => {
    mediaService = {
      toDtoList: jest.fn(),
    };
    clientService = {
      getClientDto: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatMessageToDtoService,
        {
          provide: MediaService,
          useValue: mediaService,
        },
        {
          provide: ClientService,
          useValue: clientService,
        },
      ],
    }).compile();

    service = module.get<ChatMessageToDtoService>(ChatMessageToDtoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('toDtoList', () => {
    it('should return a list of DTOs when messages are provided', async () => {
      // Given (Arrange)
      const messages = [{ id: 'msg-1' }, { id: 'msg-2' }] as any;
      const budgetId = 'budget-123';
      const userId = 'user-456';

      clientService.getClientDto.mockResolvedValue({ id: 'client-1' } as any);
      mediaService.toDtoList.mockResolvedValue([]);

      // When (Act)
      const result = await service.toDtoList(userId, budgetId, messages);

      // Then (Assert)
      expect(result).toHaveLength(2);
      expect(clientService.getClientDto).toHaveBeenCalledTimes(2);
      expect(mediaService.toDtoList).toHaveBeenCalledTimes(2);
    });

    it('should return an empty array when input list is empty', async () => {
      const result = await service.toDtoList('u' as any, 'b' as any, []);
      expect(result).toEqual([]);
    });
  });

  describe('toDto', () => {
    it('should correctly map a BudgetChatMessage to BudgetChatMessageDto (Happy Path)', async () => {
      // Given (Arrange)
      const mockMessage = {
        type: 'TEXT',
        owner: 'owner-id',
        message: 'hello world',
        medias: [{ id: 'm1' }],
        mediaType: 'IMAGE',
        offer: null,
        schedule: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        vizualized: true,
        id: 'msg-id-123',
      } as any;

      const mockClientDto = { name: 'Client Name' } as any;
      const mockMediaDtos = [{ url: 'http://media' }] as any;

      clientService.getClientDto.mockResolvedValue(mockClientDto);
      mediaService.toDtoList.mockResolvedValue(mockMediaDtos);

      // When (Act)
      const result = await service.toDto('user-id', 'budget-id', mockMessage);

      // Then (Assert)
      expect(result.id).toBe(mockMessage.id);
      expect(result.message).toBe(mockMessage.message);
      expect(result.owner).toEqual(mockClientDto);
      expect(result.medias).toEqual(mockMediaDtos);
      expect(clientService.getClientDto).toHaveBeenCalledWith(
        null,
        mockMessage.owner,
      );
      expect(mediaService.toDtoList).toHaveBeenCalledWith(
        'user-id',
        mockMessage.medias,
      );
    });

    it('should use provided medias argument if message.medias is null or undefined', async () => {
      // Given (Arrange)
      const mockMessage = { medias: null } as any;
      const overrideMedias = [{ id: 'override' }] as any;
      mediaService.toDtoList.mockResolvedValue([]);

      // When (Act)
      await service.toDto('u', 'b', mockMessage, overrideMedias);

      // Then (Assert)
      expect(mediaService.toDtoList).toHaveBeenCalledWith('u', overrideMedias);
    });

    it('should propagate errors when clientService fails', async () => {
      // Given (Arrange)
      clientService.getClientDto.mockRejectedValue(
        new Error('Client not found'),
      );

      // When & Then (Act & Assert)
      await expect(service.toDto('u', 'b', {} as any)).rejects.toThrow(
        'Client not found',
      );
    });
  });
});
