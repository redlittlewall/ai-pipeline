import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AddBudgetChatMessageService } from './AddBudgetChatMessage.Service';
import { BudgetChatMessage } from 'model/budget/BudgetChatMessage.entity';
import { BudgetChatSocketService } from './BudgetChatSocket.Service';
import { ChatMessageToDtoService } from './ChatMessageToDto.Service';
import { BudgetNotificationService } from '../notification/BudgetNotification.service';
import { MediaService } from 'modules/media/media.service';
import { BudgetChatMessageType } from 'enums/BudgetChatMessageType';
import { MediaTypeEnum } from 'enums/FileTypeEnum';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';

describe('AddBudgetChatMessageService', () => {
  let service: AddBudgetChatMessageService;
  let budgetChatMessageRepository: any;
  let budgetChatSocketService: any;
  let chatMessageToDtoService: any;
  let budgetNotificationService: any;
  let mediaService: any;

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
    budgetChatSocketService = {
      processMessage: jest.fn(),
    };
    chatMessageToDtoService = {
      toDto: jest.fn(),
    };
    budgetNotificationService = {
      notify: jest.fn(),
    };
    mediaService = {
      processAndSaveMedia: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddBudgetChatMessageService,
        {
          provide: getRepositoryToken(BudgetChatMessage),
          useValue: budgetChatMessageRepository,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
        {
          provide: ChatMessageToDtoService,
          useValue: chatMessageToDtoService,
        },
        {
          provide: BudgetNotificationService,
          useValue: budgetNotificationService,
        },
        {
          provide: MediaService,
          useValue: mediaService,
        },
      ],
    }).compile();

    service = module.get<AddBudgetChatMessageService>(
      AddBudgetChatMessageService,
    );
  });

  describe('newChatMessage', () => {
    const mockBudget = { id: 'budget-1' } as any;
    const mockOwner = { id: 'owner-1' } as any;
    const mockTarget = { id: 'target-1' } as any;

    it('should save a text message and notify when a simple message is provided', async () => {
      const messageText = 'Hello there';
      budgetChatMessageRepository.save.mockResolvedValueOnce({
        id: 'mock-id',
        type: BudgetChatMessageType.message,
        message: messageText,
      } as any);

      await service.newChatMessage(
        mockBudget,
        messageText,
        mockOwner,
        mockTarget,
        false,
        [],
        null as any,
      );

      expect(budgetChatMessageRepository.save).toHaveBeenCalled();
      const savedMessage = budgetChatMessageRepository.save.mock.calls[0][0];
      expect(savedMessage.type).toBe(BudgetChatMessageType.message);
      expect(savedMessage.message).toBe(messageText);

      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        mockBudget,
        mockOwner,
        mockTarget,
        BudgetNotificationType.NEW_CHAT,
      );
      expect(budgetChatSocketService.processMessage).not.toHaveBeenCalled();
    });

    it('should save an offer message when an offer is provided', async () => {
      const mockOffer = { id: 'offer-1' } as any;
      budgetChatMessageRepository.save.mockResolvedValueOnce({
        id: 'mock-id',
        type: BudgetChatMessageType.new_price,
        offer: mockOffer,
      } as any);

      await service.newChatMessage(
        mockBudget,
        null as any,
        mockOwner,
        mockTarget,
        false,
        [],
        null as any,
        mockOffer,
      );

      expect(budgetChatMessageRepository.save).toHaveBeenCalled();
      const savedMessage = budgetChatMessageRepository.save.mock.calls[0][0];
      expect(savedMessage.type).toBe(BudgetChatMessageType.new_price);
      expect(savedMessage.offer).toBe(mockOffer);
    });

    it('should save a schedule message when a schedule is provided', async () => {
      const mockSchedule = { id: 'schedule-1' } as any;
      budgetChatMessageRepository.save.mockResolvedValueOnce({
        id: 'mock-id',
        type: BudgetChatMessageType.new_schedule,
        schedule: mockSchedule,
      } as any);

      await service.newChatMessage(
        mockBudget,
        null as any,
        mockOwner,
        mockTarget,
        false,
        [],
        null as any,
        null as any,
        mockSchedule,
      );

      expect(budgetChatMessageRepository.save).toHaveBeenCalled();
      const savedMessage = budgetChatMessageRepository.save.mock.calls[0][0];
      expect(savedMessage.type).toBe(BudgetChatMessageType.new_schedule);
      expect(savedMessage.schedule).toBe(mockSchedule);
    });

    it('should save media message and upload files when files and mediaContext are provided', async () => {
      const mockFiles = [{ originalname: 'test.png' }] as any[];
      const savedEntity = {
        id: 'mock-id',
        type: BudgetChatMessageType.media,
        mediaType: MediaTypeEnum.IMAGE,
      };
      budgetChatMessageRepository.save.mockResolvedValueOnce(
        savedEntity as any,
      );
      mediaService.processAndSaveMedia.mockResolvedValueOnce({
        id: 'media-1',
      } as any);

      await service.newChatMessage(
        mockBudget,
        'image comment',
        mockOwner,
        mockTarget,
        false,
        mockFiles,
        MediaTypeEnum.IMAGE,
      );

      expect(budgetChatMessageRepository.save).toHaveBeenCalled();
      const savedMessage = budgetChatMessageRepository.save.mock.calls[0][0];
      expect(savedMessage.type).toBe(BudgetChatMessageType.media);
      expect(savedMessage.mediaType).toBe(MediaTypeEnum.IMAGE);

      expect(mediaService.processAndSaveMedia).toHaveBeenCalledWith(
        mockOwner.id,
        mockFiles[0],
        'mock-id',
        null,
        null,
      );
    });

    it('should send socket message when socketSend is true', async () => {
      const mockDto = { id: 'dto-1' };
      const savedEntity = { id: 'mock-id' };
      budgetChatMessageRepository.save.mockResolvedValueOnce(
        savedEntity as any,
      );
      chatMessageToDtoService.toDto.mockResolvedValueOnce(mockDto);

      await service.newChatMessage(
        mockBudget,
        'Hello via socket',
        mockOwner,
        mockTarget,
        true,
        [],
        null as any,
      );

      expect(chatMessageToDtoService.toDto).toHaveBeenCalledWith(
        mockOwner.id,
        mockBudget.id,
        savedEntity,
        [],
      );
      expect(budgetChatSocketService.processMessage).toHaveBeenCalledWith(
        mockOwner.id,
        mockTarget.id,
        mockDto,
      );
    });

    it('should propagate errors when repository save fails', async () => {
      budgetChatMessageRepository.save.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(
        service.newChatMessage(
          mockBudget,
          'Hello',
          mockOwner,
          mockTarget,
          false,
          [],
          null as any,
        ),
      ).rejects.toThrow('Database error');
    });
  });

  describe('uploadFiles', () => {
    it('should process and return audio media when mediaType is AUDIO', async () => {
      const mockFiles = [{ filename: 'audio.mp3' }] as any[];
      const mockMedia = { id: 'media-audio-1' } as any;
      mediaService.processAndSaveMedia.mockResolvedValueOnce(mockMedia);

      const result = await service.uploadFiles(
        MediaTypeEnum.AUDIO,
        mockFiles,
        'client-1',
        'chat-message-1',
        'avatar-1',
      );

      expect(mediaService.processAndSaveMedia).toHaveBeenCalledTimes(1);
      expect(mediaService.processAndSaveMedia).toHaveBeenCalledWith(
        'client-1',
        mockFiles[0],
        'chat-message-1',
        'avatar-1',
        null,
      );
      expect(result).toEqual([mockMedia]);
    });

    it('should process and return image media items when mediaType is IMAGE', async () => {
      const mockFiles = [
        { filename: 'image1.png' },
        { filename: 'image2.png' },
      ] as any[];
      const mockMedia1 = { id: 'media-img-1' } as any;
      const mockMedia2 = { id: 'media-img-2' } as any;

      mediaService.processAndSaveMedia
        .mockResolvedValueOnce(mockMedia1)
        .mockResolvedValueOnce(mockMedia2);

      const result = await service.uploadFiles(
        MediaTypeEnum.IMAGE,
        mockFiles,
        'client-1',
        'chat-message-1',
        'avatar-1',
      );

      expect(mediaService.processAndSaveMedia).toHaveBeenCalledTimes(2);
      expect(result).toEqual([mockMedia1, mockMedia2]);
    });

    it('should return empty array when files is empty or undefined', async () => {
      const result = await service.uploadFiles(
        MediaTypeEnum.IMAGE,
        [],
        'client-1',
        'chat-message-1',
        'avatar-1',
      );

      expect(mediaService.processAndSaveMedia).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should propagate error when mediaService processAndSaveMedia fails', async () => {
      const mockFiles = [{ filename: 'test.png' }] as any[];
      mediaService.processAndSaveMedia.mockRejectedValueOnce(
        new Error('Upload failed'),
      );

      await expect(
        service.uploadFiles(
          MediaTypeEnum.IMAGE,
          mockFiles,
          'client-1',
          'chat-1',
          'avatar-1',
        ),
      ).rejects.toThrow('Upload failed');
    });
  });
});
