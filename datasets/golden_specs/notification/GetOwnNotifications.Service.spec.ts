import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetOwnNotificationsService } from './GetOwnNotifications.Service';
import { Notifications } from 'model/notification/Notifications.entity';
import { BasicUserInfoService } from 'modules/users/BasicUserInfo.service';
import { GetTattooMinimalService } from 'modules/tattoo/GetTattooMinimal.Service';
import { NotificationType } from 'enums/NotificationType';

describe('GetOwnNotificationsService', () => {
  let service: GetOwnNotificationsService;
  let notificationsRepository: any;
  let basicUserInfoService: any;
  let getTattooMinimalService: any;

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
    basicUserInfoService = {
      get: jest.fn(),
    };
    getTattooMinimalService = {
      getMinimal: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetOwnNotificationsService,
        {
          provide: getRepositoryToken(Notifications),
          useValue: notificationsRepository,
        },
        {
          provide: BasicUserInfoService,
          useValue: basicUserInfoService,
        },
        {
          provide: GetTattooMinimalService,
          useValue: getTattooMinimalService,
        },
      ],
    }).compile();

    service = module.get<GetOwnNotificationsService>(
      GetOwnNotificationsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should return mapped notifications successfully (Happy Path)', async () => {
      // Arrange
      const mockNotification = {
        id: 'notif-1',
        message: JSON.stringify({ text: 'hello' }),
        referencesTattoo: { id: 'tattoo-1' },
        senderClient: { id: 'sender-1' },
        receiverClient: { id: 'receiver-1' },
        createdAt: new Date('2023-01-01'),
        confirmed: true,
        visualized: false,
      } as any;

      notificationsRepository.find.mockResolvedValueOnce([mockNotification]);
      basicUserInfoService.get.mockResolvedValue({ id: 'user-info' });
      getTattooMinimalService.getMinimal.mockResolvedValue({
        id: 'minimal-tattoo',
      });

      // Act
      const result = await service.call('user-id', 0, 10);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('notif-1');
      expect(notificationsRepository.update).toHaveBeenCalled();
      expect(basicUserInfoService.get).toHaveBeenCalledTimes(2);
      expect(getTattooMinimalService.getMinimal).toHaveBeenCalled();
    });

    it('should filter by type when provided', async () => {
      // Arrange
      notificationsRepository.find.mockResolvedValueOnce([]);

      // Act
      await service.call('user-id', 0, 10, NotificationType.TAG_MENTION);

      // Assert
      expect(notificationsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            receiverClient: { id: 'user-id' },
            type: NotificationType.TAG_MENTION,
          },
        }),
      );
    });

    it('should not call getMinimal when referencesTattoo is null', async () => {
      // Arrange
      const mockNotification = {
        id: 'notif-1',
        message: JSON.stringify({ text: 'hello' }),
        referencesTattoo: null,
        createdAt: new Date(),
      } as any;

      notificationsRepository.find.mockResolvedValueOnce([mockNotification]);

      // Act
      await service.call('user-id', 0, 10);

      // Assert
      expect(getTattooMinimalService.getMinimal).not.toHaveBeenCalled();
    });

    it('should skip notification if JSON parsing fails', async () => {
      // Arrange
      const mockNotification = {
        id: 'notif-1',
        message: 'invalid-json',
        createdAt: new Date(),
      } as any;

      notificationsRepository.find.mockResolvedValueOnce([mockNotification]);

      // Act
      const result = await service.call('user-id', 0, 10);

      // Assert
      expect(result).toHaveLength(0);
    });

    it('should skip notification if basicUserInfoService fails', async () => {
      // Arrange
      const mockNotification = {
        id: 'notif-1',
        message: JSON.stringify({ text: 'hello' }),
        senderClient: { id: 'sender-1' },
        createdAt: new Date(),
      } as any;

      notificationsRepository.find.mockResolvedValueOnce([mockNotification]);
      basicUserInfoService.get.mockRejectedValueOnce(
        new Error('User not found'),
      );

      // Act
      const result = await service.call('user-id', 0, 10);

      // Assert
      expect(result).toHaveLength(0);
    });
  });
});
