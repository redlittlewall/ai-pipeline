import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationWorkflow } from './NotificationWorkflow.Service';
import { Notifications } from 'model/notification/Notifications.entity';
import { Client } from 'model/users/Client.entity';
import { Configurations } from 'model/Configurations.entity';
import { FindUserSocketByConfigurationsService } from 'modules/sockets/FindUserSocketByConfigurations.Serivce';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { SocketGateWay } from 'modules/sockets/Socket.Gateway';
import { SupportedLanguages } from 'enums/SupportedLanguages';

describe('NotificationWorkflow', () => {
  let service: NotificationWorkflow;
  let notificationsRepository: any;
  let clientRepository: any;
  let configurationsRepository: any;
  let sendSocketOrPushService: any;
  let firebaseService: any;
  let socketGateway: any;

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
    notificationsRepository = createMockRepository();
    clientRepository = createMockRepository();
    configurationsRepository = createMockRepository();
    sendSocketOrPushService = {
      find: jest.fn(),
    };
    firebaseService = {
      sendMessage: jest.fn(),
    };
    socketGateway = {
      updateNotifications: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationWorkflow,
        {
          provide: getRepositoryToken(Notifications),
          useValue: notificationsRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Configurations),
          useValue: configurationsRepository,
        },
        {
          provide: FindUserSocketByConfigurationsService,
          useValue: sendSocketOrPushService,
        },
        {
          provide: FirebaseService,
          useValue: firebaseService,
        },
        {
          provide: SocketGateWay,
          useValue: socketGateway,
        },
      ],
    }).compile();

    service = module.get<NotificationWorkflow>(NotificationWorkflow);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should execute call successfully (Happy Path)', async () => {
      // Arrange
      const mockClient = { id: 'user-1', pushToken: 'token-123' };
      const mockNotification = {
        type: 'TEST_TYPE',
        message: 'Hello',
        title: 'Hi',
      } as any;
      const mockConfig = { language: SupportedLanguages.ENGLISH };

      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      sendSocketOrPushService.find.mockResolvedValueOnce({
        sendTo: 'PUSH',
      } as any);
      notificationsRepository.save.mockResolvedValueOnce({
        id: 'notif-1',
      } as any);
      configurationsRepository.findOne.mockResolvedValueOnce(mockConfig as any);

      // Act
      await service.call('user-1', mockNotification, true);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: ['pushToken', 'id'],
      });
      expect(notificationsRepository.save).toHaveBeenCalled();
      expect(firebaseService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'notif-1' }),
        'token-123',
        SupportedLanguages.ENGLISH,
      );
    });

    it('should use default language when configuration is missing', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'user-1',
        pushToken: 'token-123',
      } as any);
      configurationsRepository.findOne.mockResolvedValueOnce(null);

      // Act
      await service.call('user-1', { type: 'TEST' } as any, true);

      // Assert
      expect(firebaseService.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        SupportedLanguages.PORTUGUES,
      );
    });

    it('should handle firebase error gracefully (Sad Path)', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'user-1',
        pushToken: 'token-123',
      } as any);
      firebaseService.sendMessage.mockRejectedValueOnce(
        new Error('Firebase connection failed'),
      );

      // Act & Assert
      // The service catches the error internally, so it should resolve
      await expect(
        service.call('user-1', { type: 'TEST' } as any, true),
      ).resolves.not.toThrow();
      expect(firebaseService.sendMessage).toHaveBeenCalled();
    });

    it('should proceed even if sendSocketOrPushService returns null', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'user-1',
        pushToken: 'token-123',
      } as any);
      sendSocketOrPushService.find.mockResolvedValueOnce(null);

      // Act
      await service.call('user-1', { type: 'TEST' } as any, true);

      // Assert
      expect(notificationsRepository.save).toHaveBeenCalled();
      // Verify that the saved notification has notificationPushed set to false (default behavior when sendType is null)
      expect(notificationsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ notificationPushed: false }),
      );
    });
  });
});
