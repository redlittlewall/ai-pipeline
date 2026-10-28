import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateCommentService } from './CreateComment.service';
import { Comment } from 'model/comments/Comment.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Client } from 'model/users/Client.entity';
import { Avatar } from 'model/Avatar.entity';
import { Badges } from 'model/Badges.entity';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { AvatarService } from 'modules/avatar/AvatarService';

describe('CreateCommentService', () => {
  let service: CreateCommentService;
  let commentsRepository: any;
  let tattooEntityRepository: any;
  let clientRepository: any;
  let avatarRepository: any;
  let BadgeRepository: any;
  let hashtagRepository: any;
  let notificationWorkflow: any;
  let avatarService: any;

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
    commentsRepository = createMockRepository();
    tattooEntityRepository = createMockRepository();
    clientRepository = createMockRepository();
    avatarRepository = createMockRepository();
    BadgeRepository = createMockRepository();
    hashtagRepository = createMockRepository();
    notificationWorkflow = {
      call: jest.fn(),
    };
    avatarService = {
      getAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateCommentService,
        {
          provide: getRepositoryToken(Comment),
          useValue: commentsRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: getRepositoryToken(Badges),
          useValue: BadgeRepository,
        },
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
        {
          provide: AvatarService,
          useValue: avatarService,
        },
      ],
    }).compile();

    service = module.get<CreateCommentService>(CreateCommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publish', () => {
    it('should execute publish successfully and notify artist when not the requester (Happy Path)', async () => {
      // Given
      const tattooMock = {
        id: 'tattoo-1',
        artist: { id: 'artist-1', client: { id: 'client-artist' } },
      } as any;
      const requesterMock = {
        id: 'requester-1',
        username: 'user1',
        badge: { id: 'badge-1' },
      } as any;
      const avatarMock = { id: 'avatar-1' } as any;
      const badgeMock = { id: 'badge-1' } as any;
      const savedCommentMock = {
        id: 'comment-1',
        comment: 'great photo',
        createdAt: new Date(),
      } as any;

      tattooEntityRepository.findOne.mockResolvedValueOnce(tattooMock);
      clientRepository.findOne.mockResolvedValueOnce(requesterMock);
      avatarRepository.findOne.mockResolvedValueOnce(avatarMock);
      BadgeRepository.findOne.mockResolvedValueOnce(badgeMock);
      // First save for new Comment(...)
      commentsRepository.save.mockResolvedValueOnce(savedCommentMock);
      // Second save for savedComment.mentioned...
      commentsRepository.save.mockResolvedValueOnce(savedCommentMock);

      avatarService.getAvatar.mockResolvedValueOnce({
        url: 'avatar-url',
      } as any);

      // When
      const result = await service.publish(
        'tattoo-1',
        'requester-1',
        'great photo',
        null,
        [],
        [],
      );

      // Then
      expect(result).toBeDefined();
      expect(result.comment).toBe('great photo');
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        'artist-1',
        expect.objectContaining({ specificType: 'NEW_COMMENT' }),
        true,
      );
    });

    it('should handle reply comments and notify the original commenter', async () => {
      // Given
      const tattooMock = { id: 't1', artist: { id: 'a1' } } as any;
      const requesterMock = { id: 'r1', username: 'replier' } as any;
      const baseCommentMock = {
        id: 'bc1',
        client: { id: 'original-commenter' },
      } as any;

      tattooEntityRepository.findOne.mockResolvedValueOnce(tattooMock);
      clientRepository.findOne.mockResolvedValueOnce(requesterMock);
      commentsRepository.findOne.mockResolvedValueOnce(baseCommentMock);

      const replyMock = { id: 'reply-1', createdAt: new Date() } as any;
      commentsRepository.save.mockResolvedValueOnce(replyMock);
      commentsRepository.save.mockResolvedValueOnce(replyMock);

      // When
      await service.publish('t1', 'r1', 'reply text', 'bc1', [], []);

      // Then
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        'original-commenter',
        expect.objectContaining({ specificType: 'COMMENT_REPLIED' }),
        true,
      );
    });

    it('should notify mentioned clients', async () => {
      // Given
      const tattooMock = { id: 't1' } as any;
      const requesterMock = { id: 'r1', username: 'tagger' } as any;
      const taggedClientMock = { id: 'tagged-1' } as any;
      const savedCommentMock = { id: 'c1', createdAt: new Date() } as any;

      tattooEntityRepository.findOne.mockResolvedValueOnce(tattooMock);
      clientRepository.findOne.mockResolvedValueOnce(requesterMock);
      clientRepository.findOne.mockResolvedValueOnce(taggedClientMock); // for the mention loop

      commentsRepository.save.mockResolvedValueOnce(savedCommentMock);
      commentsRepository.save.mockResolvedValueOnce(savedCommentMock);

      // When
      await service.publish(
        't1',
        'r1',
        'hello @user',
        null,
        [{ id: 'tagged-1' }] as any,
        [],
      );

      // Then
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        'tagged-1',
        expect.objectContaining({ specificType: 'TAG_MENTION' }),
        true,
      );
    });

    it('should save mentioned hashtags to the comment', async () => {
      // Given
      const tattooMock = { id: 't1' } as any;
      const requesterMock = { id: 'r1' } as any;
      const hashtagMock = { id: 'h1', name: 'art' } as any;
      const savedCommentMock = { id: 'c1', createdAt: new Date() } as any;

      tattooEntityRepository.findOne.mockResolvedValueOnce(tattooMock);
      clientRepository.findOne.mockResolvedValueOnce(requesterMock);
      hashtagRepository.findOne.mockResolvedValueOnce(hashtagMock);

      commentsRepository.save.mockResolvedValueOnce(savedCommentMock);
      commentsRepository.save.mockResolvedValueOnce(savedCommentMock);

      // When
      await service.publish('t1', 'r1', '#art', null, [], [
        { hashtagId: 'h1' },
      ] as any);

      // Then
      expect(commentsRepository.save).toHaveBeenCalledTimes(2);
      expect(hashtagRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'h1' },
      });
    });

    it('should propagate errors if tattoo is not found', async () => {
      // Given
      tattooEntityRepository.findOne.mockRejectedValueOnce(
        new Error('Tattoo not found'),
      );

      // When & Then
      await expect(
        service.publish('invalid', 'r1', 'text', null, [], []),
      ).rejects.toThrow('Tattoo not found');
    });
  });
});
