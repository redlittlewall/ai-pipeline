import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetCommentDetailsDtoService } from './GetCommentDetailsDto.Service';
import { Client } from 'model/users/Client.entity';
import { Avatar } from 'model/Avatar.entity';
import { Badges } from 'model/Badges.entity';
import { Comment } from 'model/comments/Comment.entity';
import { ClientInteractComment } from 'model/users/relations/ClientInteractComment.entity';
import { AvatarService } from 'modules/avatar/AvatarService';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('GetCommentDetailsDtoService', () => {
  let service: GetCommentDetailsDtoService;
  let clientRepository: any;
  let avatarRepository: any;
  let badgeRepository: any;
  let commentRepository: any;
  let clientInteractCommentRepository: any;
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
    clientRepository = createMockRepository();
    avatarRepository = createMockRepository();
    badgeRepository = createMockRepository();
    commentRepository = createMockRepository();
    clientInteractCommentRepository = createMockRepository();
    avatarService = {
      getAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetCommentDetailsDtoService,
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
          useValue: badgeRepository,
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: commentRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractComment),
          useValue: clientInteractCommentRepository,
        },
        {
          provide: AvatarService,
          useValue: avatarService,
        },
      ],
    }).compile();

    service = module.get<GetCommentDetailsDtoService>(
      GetCommentDetailsDtoService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCommentDetails', () => {
    it('should return default deleted user comment details when client does not exist', async () => {
      // Arrange
      const comment = {
        id: 'comment-1',
        client: 'client-deleted-id',
        comment: 'Great photo!',
        answerComment: null,
        createdAt: new Date('2023-01-01'),
      };
      clientRepository.findOne.mockResolvedValueOnce(null);

      // Act
      const result = await service.getCommentDetails('requester-1', comment);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: comment.client },
        relations: ['badge', 'avatar'],
      });
      expect(result).toBeDefined();
      expect(result.client.id).toBe('deleted');
      expect(result.client.name).toBe('[Usuário removido]');
      expect(result.id).toBe(comment.id);
      expect(result.comment).toBe(comment.comment);
      expect(result.numberOfLikes).toBe(0);
      expect(result.userLikes).toBe(false);
      expect(result.qtAnswers).toBe(0);
      expect(result.date).toEqual(comment.createdAt);
    });

    it('should return full comment details when client exists and user liked the comment', async () => {
      // Arrange
      const comment = {
        id: 'comment-2',
        client: 'client-1',
        comment: 'Nice shot!',
        answerComment: 'parent-comment-id',
        createdAt: new Date('2023-05-10'),
      };
      const mockClient = {
        id: 'client-1',
        username: 'john_doe',
        badge: { id: 'badge-1' },
      };
      const mockAvatar = { id: 'avatar-1', url: 'http://avatar.jpg' };

      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      avatarService.getAvatar.mockResolvedValueOnce(mockAvatar as any);
      clientInteractCommentRepository.count
        .mockResolvedValueOnce(10) // totalLikes
        .mockResolvedValueOnce(1); // userLike > 0 -> true
      commentRepository.count.mockResolvedValueOnce(2); // totalAnswers

      // Act
      const result = await service.getCommentDetails('requester-1', comment);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: comment.client },
        relations: ['badge', 'avatar'],
      });
      expect(avatarService.getAvatar).toHaveBeenCalledWith(mockClient.id);
      expect(clientInteractCommentRepository.count).toHaveBeenNthCalledWith(1, {
        where: {
          comment: { id: comment.id },
          interactionType: ClientInteractionEnum.LIKE,
        },
      });
      expect(commentRepository.count).toHaveBeenCalledWith({
        where: { answerComment: comment.id },
      });
      expect(clientInteractCommentRepository.count).toHaveBeenNthCalledWith(2, {
        where: {
          comment: { id: comment.id },
          client: { id: 'requester-1' },
          interactionType: ClientInteractionEnum.LIKE,
        },
      });

      expect(result).toBeDefined();
      expect(result.client.id).toBe(mockClient.id);
      expect(result.client.username).toBe(mockClient.username);
      expect(result.client.avatar).toBe(mockAvatar);
      expect(result.client.badge).toBe(mockClient.badge);
      expect(result.id).toBe(comment.id);
      expect(result.comment).toBe(comment.comment);
      expect(result.answerComment).toBe(comment.answerComment);
      expect(result.numberOfLikes).toBe(10);
      expect(result.userLikes).toBe(true);
      expect(result.qtAnswers).toBe(2);
      expect(result.date).toEqual(comment.createdAt);
    });

    it('should set userLikes to false when requester has not liked the comment', async () => {
      // Arrange
      const comment = {
        id: 'comment-3',
        client: 'client-2',
        comment: 'Awesome!',
        answerComment: null,
        createdAt: new Date(),
      };
      const mockClient = {
        id: 'client-2',
        username: 'jane_doe',
        badge: null,
      };

      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      avatarService.getAvatar.mockResolvedValueOnce(null);
      clientInteractCommentRepository.count
        .mockResolvedValueOnce(5) // totalLikes
        .mockResolvedValueOnce(0); // userLike = 0 -> false
      commentRepository.count.mockResolvedValueOnce(0);

      // Act
      const result = await service.getCommentDetails('requester-2', comment);

      // Assert
      expect(result.userLikes).toBe(false);
      expect(result.numberOfLikes).toBe(5);
    });

    it('should propagate error when repository throws exception', async () => {
      // Arrange
      const comment = {
        id: 'comment-err',
        client: 'client-err',
      };
      clientRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // Act & Assert
      await expect(
        service.getCommentDetails('requester-1', comment),
      ).rejects.toThrow('Database error');
    });
  });
});
