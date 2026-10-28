import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetCommentAnswersService } from './GetCommentAnswers.service';
import { Client } from 'model/users/Client.entity';
import { Comment } from 'model/comments/Comment.entity';
import { Badges } from 'model/Badges.entity';
import { Avatar } from 'model/Avatar.entity';
import { GetCommentDetailsDtoService } from './GetCommentDetailsDto.Service';
import { AvatarService } from 'modules/avatar/AvatarService';
import { GenericException } from 'exceptions/GenericException';
import { HttpStatus } from '@nestjs/common';

describe('GetCommentAnswersService', () => {
  let service: GetCommentAnswersService;
  let clientRepository: any;
  let commentRepository: any;
  let badgeRepository: any;
  let avatarRepository: any;
  let getCommentDetailsDtoService: any;
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
    commentRepository = createMockRepository();
    badgeRepository = createMockRepository();
    avatarRepository = createMockRepository();
    getCommentDetailsDtoService = {
      getCommentDetails: jest.fn(),
    };
    avatarService = {
      getAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetCommentAnswersService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: commentRepository,
        },
        {
          provide: getRepositoryToken(Badges),
          useValue: badgeRepository,
        },
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: GetCommentDetailsDtoService,
          useValue: getCommentDetailsDtoService,
        },
        {
          provide: AvatarService,
          useValue: avatarService,
        },
      ],
    }).compile();

    service = module.get<GetCommentAnswersService>(GetCommentAnswersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAnswers', () => {
    it('should return PhotoCommentListDto when comment and client exist (Happy Path)', async () => {
      // Given (Arrange)
      const mockComment = { id: 'comment-1' } as any;
      const mockClient = {
        id: 'client-1',
        username: 'john_doe',
        badge: { id: 'badge-1' },
      } as any;
      const mockAnswerComment = {
        id: 'answer-1',
        answerComment: 'comment-1',
      } as any;
      const mockBadge = { id: 'badge-1', name: 'Top Contributor' } as any;
      const mockAvatarDto = { url: 'http://avatar.com/1.png' } as any;
      const mockCommentDetailsDto = {
        id: 'answer-1',
        comment: 'Nice photo!',
      } as any;

      commentRepository.findOne.mockResolvedValueOnce(mockComment);
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      commentRepository.find.mockResolvedValueOnce([mockAnswerComment]);
      getCommentDetailsDtoService.getCommentDetails.mockResolvedValueOnce(
        mockCommentDetailsDto,
      );
      avatarRepository.findOne.mockResolvedValueOnce({ id: 'avatar-1' } as any);
      badgeRepository.findOne.mockResolvedValueOnce(mockBadge);
      avatarService.getAvatar.mockResolvedValueOnce(mockAvatarDto);

      // When (Act)
      const result = await service.getAnswers('client-1', 'comment-1');

      // Then (Assert)
      expect(commentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
      });
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        loadRelationIds: {
          relations: ['badge'],
          disableMixedMap: true,
        },
      });
      expect(commentRepository.find).toHaveBeenCalledWith({
        where: { answerComment: 'comment-1' },
        loadRelationIds: true,
      });
      expect(
        getCommentDetailsDtoService.getCommentDetails,
      ).toHaveBeenCalledWith('client-1', mockAnswerComment);
      expect(badgeRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'badge-1' },
      });
      expect(avatarService.getAvatar).toHaveBeenCalledWith('client-1');

      expect(result).toBeDefined();
      expect(result.client.id).toBe('client-1');
      expect(result.client.username).toBe('john_doe');
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]).toEqual(mockCommentDetailsDto);
    });

    it('should return PhotoCommentListDto with empty comments list when no answers exist', async () => {
      // Given (Arrange)
      const mockComment = { id: 'comment-1' } as any;
      const mockClient = {
        id: 'client-1',
        username: 'john_doe',
        badge: { id: 'badge-1' },
      } as any;

      commentRepository.findOne.mockResolvedValueOnce(mockComment);
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      commentRepository.find.mockResolvedValueOnce([]);
      avatarRepository.findOne.mockResolvedValueOnce(null);
      badgeRepository.findOne.mockResolvedValueOnce(null);
      avatarService.getAvatar.mockResolvedValueOnce(null);

      // When (Act)
      const result = await service.getAnswers('client-1', 'comment-1');

      // Then (Assert)
      expect(result).toBeDefined();
      expect(result.comments).toEqual([]);
      expect(
        getCommentDetailsDtoService.getCommentDetails,
      ).not.toHaveBeenCalled();
    });

    it('should throw GenericException with NOT_FOUND when comment does not exist', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockResolvedValueOnce({ id: 'client-1' } as any);

      // When & Then (Act & Assert)
      await expect(
        service.getAnswers('client-1', 'invalid-comment'),
      ).rejects.toThrow(
        new GenericException(
          'Comment invalid-comment not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should throw GenericException with NOT_FOUND when client does not exist', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockResolvedValueOnce({
        id: 'comment-1',
      } as any);
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      await expect(
        service.getAnswers('invalid-client', 'comment-1'),
      ).rejects.toThrow(
        new GenericException(
          'Client invalid-client not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should propagate errors when repository findOne throws an error', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then (Act & Assert)
      await expect(service.getAnswers('client-1', 'comment-1')).rejects.toThrow(
        'Database error',
      );
    });
  });
});
