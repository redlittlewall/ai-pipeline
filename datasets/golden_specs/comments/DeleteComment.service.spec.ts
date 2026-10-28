import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeleteCommentService } from './DeleteComment.service';
import { Comment } from 'model/comments/Comment.entity';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

describe('DeleteCommentService', () => {
  let service: DeleteCommentService;
  let commentRepository: any;

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
    commentRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteCommentService,
        {
          provide: getRepositoryToken(Comment),
          useValue: commentRepository,
        },
      ],
    }).compile();

    service = module.get<DeleteCommentService>(DeleteCommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('delete', () => {
    it('should delete comment and its answers when user is the owner (Happy Path)', async () => {
      // Given (Arrange)
      const userId = 'user-123';
      const commentId = 'comment-456';
      const mockComment = {
        id: commentId,
        client: { id: userId },
      } as any;

      commentRepository.findOne.mockResolvedValueOnce(mockComment);

      // When (Act)
      await service.delete(userId, commentId);

      // Then (Assert)
      expect(commentRepository.findOne).toHaveBeenCalledWith({
        where: { id: commentId },
        relations: ['client'],
      });
      expect(commentRepository.softDelete).toHaveBeenCalledWith(commentId);
      expect(commentRepository.softDelete).toHaveBeenCalledWith({
        answerComment: commentId,
      });
    });

    it('should throw NotFoundException when comment does not exist', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      await expect(service.delete('any-user', 'invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw UnauthorizedException when user is not the owner', async () => {
      // Given (Arrange)
      const userId = 'user-123';
      const ownerId = 'different-user';
      const commentId = 'comment-456';
      const mockComment = {
        id: commentId,
        client: { id: ownerId },
      } as any;

      commentRepository.findOne.mockResolvedValueOnce(mockComment);

      // When & Then (Act & Assert)
      await expect(service.delete(userId, commentId)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(commentRepository.softDelete).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository fails', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then (Act & Assert)
      await expect(service.delete('user', 'comment')).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
