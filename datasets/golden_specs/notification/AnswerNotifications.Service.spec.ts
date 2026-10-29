import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnswerNotificationsService } from './AnswerNotifications.Service';
import { Notifications } from 'model/notification/Notifications.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Photo } from 'model/tattoo/Photo.entity';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';
import { SpecificType } from 'enums/SpecificType';
import { ApprovalStatus } from 'enums/ApprovalStatus';

describe('AnswerNotificationsService', () => {
  let service: AnswerNotificationsService;
  let notificationsRepository: any;
  let tattooRepository: any;
  let photoRepository: any;
  let tattooHasHashtagRepository: any;

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
    tattooRepository = createMockRepository();
    photoRepository = createMockRepository();
    tattooHasHashtagRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnswerNotificationsService,
        {
          provide: getRepositoryToken(Notifications),
          useValue: notificationsRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: getRepositoryToken(Photo),
          useValue: photoRepository,
        },
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
      ],
    }).compile();

    service = module.get<AnswerNotificationsService>(
      AnswerNotificationsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should update notification and trigger processSpecificFlows', async () => {
      const mockNotification = {
        id: 'notif-1',
        confirmed: null,
        specificType: SpecificType.ARTIST_APPROVED,
      } as any;

      notificationsRepository.findOne.mockResolvedValueOnce(mockNotification);

      await service.call('notif-1', true);

      expect(notificationsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-1',
          confirmed: true,
        }),
      );
    });

    it('should throw error if notification not found', async () => {
      notificationsRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.call('invalid-id', true)).rejects.toThrow();
    });
  });

  describe('processSpecificFlows', () => {
    it('should update hashtag suggestion when confirmed is true', async () => {
      const notification = {
        specificType: SpecificType.HASHTAG_SUGESTION,
        confirmed: true,
        referencesTattoo: { id: 't1' },
        referencesHashtag: { id: 'h1' },
        receiverClient: { id: 'c1' },
      } as any;

      await service.processSpecificFlows(notification);

      expect(tattooHasHashtagRepository.update).toHaveBeenCalledWith(
        { tattooDetails: { id: 't1' }, hashtag: { id: 'h1' } },
        expect.objectContaining({ approvedBy: notification.receiverClient }),
      );
    });

    it('should clear hashtag suggestion approval when confirmed is false', async () => {
      const notification = {
        specificType: SpecificType.HASHTAG_SUGESTION,
        confirmed: false,
        referencesTattoo: { id: 't1' },
        referencesHashtag: { id: 'h1' },
        receiverClient: { id: 'c1' },
      } as any;

      await service.processSpecificFlows(notification);

      expect(tattooHasHashtagRepository.update).toHaveBeenCalledWith(
        { tattooDetails: { id: 't1' }, hashtag: { id: 'h1' } },
        expect.objectContaining({ approvedBy: null, approvedAt: null }),
      );
    });

    it('should process new tattoo photo received and approve photos', async () => {
      const notification = {
        specificType: SpecificType.NEW_TATTOO_PHOTO_RECEIVED,
        confirmed: true,
        referencesTattoo: {
          id: 't1',
          photos: [{ id: 'p1' }, { id: 'p2' }],
        },
        receiverClient: { id: 'c1' },
      } as any;

      await service.processSpecificFlows(notification);

      expect(photoRepository.save).toHaveBeenCalledTimes(2);
      expect(tattooRepository.save).toHaveBeenCalled();
      expect(notification.referencesTattoo.status).toBe(
        ApprovalStatus.APPROVED,
      );
    });

    it('should process new tattoo photo received and reprove photos', async () => {
      const notification = {
        specificType: SpecificType.NEW_TATTOO_PHOTO_RECEIVED,
        confirmed: false,
        referencesTattoo: {
          id: 't1',
          photos: [{ id: 'p1' }],
        },
        receiverClient: { id: 'c1' },
      } as any;

      await service.processSpecificFlows(notification);

      expect(photoRepository.save).toHaveBeenCalled();
      expect(notification.referencesTattoo.status).toBe(
        ApprovalStatus.REPROVED,
      );
    });

    it('should do nothing for unhandled specific types', async () => {
      const notification = {
        specificType: SpecificType.ARTIST_PROFILE_LIKED,
      } as any;

      await service.processSpecificFlows(notification);

      expect(tattooHasHashtagRepository.update).not.toHaveBeenCalled();
      expect(tattooRepository.save).not.toHaveBeenCalled();
    });
  });
});
