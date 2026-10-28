import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LikeCommentService } from './LikeComment.service';
import { Client } from 'model/users/Client.entity';
import { Comment } from 'model/comments/Comment.entity';
import { ClientInteractComment } from 'model/users/relations/ClientInteractComment.entity';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';

describe('LikeCommentService', () => {
  let service: LikeCommentService;
  let clientRepository: any;
  let commentRepository: any;
  let clientInteractCommentRepository: any;
  let notificationWorkflow: any;

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
    clientInteractCommentRepository = createMockRepository();
    notificationWorkflow = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LikeCommentService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
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
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
      ],
    }).compile();

    service = module.get<LikeCommentService>(LikeCommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('like', () => {
    const clientId = 'client-1';
    const commentId = 'comment-1';
    const mockClient = { id: clientId, username: 'tester' } as any;
    const mockCommentOwner = { id: 'owner-1' } as any;
    const mockTattoo = { id: 'tattoo-1' } as any;
    const mockComment = {
      id: commentId,
      client: mockCommentOwner,
      tattoo: mockTattoo,
    } as any;

    it('should create a new like and send notification when no previous relation exists', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      commentRepository.findOne.mockResolvedValueOnce(mockComment);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(null);

      // Act
      const result = await service.like(clientId, commentId);

      // Assert
      expect(result).toBe(true);
      expect(clientInteractCommentRepository.save).toHaveBeenCalled();
      expect(notificationWorkflow.call).toHaveBeenCalled();
    });

    it('should restore a soft-deleted like when it exists', async () => {
      // Arrange
      const oldRelation = { id: 'rel-1', deletedAt: new Date() } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      commentRepository.findOne.mockResolvedValueOnce(mockComment);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(
        oldRelation,
      );

      // Act
      const result = await service.like(clientId, commentId);

      // Assert
      expect(result).toBe(true);
      expect(oldRelation.deletedAt).toBeNull();
      expect(clientInteractCommentRepository.save).toHaveBeenCalledWith(
        oldRelation,
      );
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should soft-delete an active like (unlike)', async () => {
      // Arrange
      const oldRelation = { id: 'rel-1', deletedAt: null } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      commentRepository.findOne.mockResolvedValueOnce(mockComment);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(
        oldRelation,
      );

      // Act
      const result = await service.like(clientId, commentId);

      // Assert
      expect(result).toBe(false);
      expect(clientInteractCommentRepository.softDelete).toHaveBeenCalledWith(
        'rel-1',
      );
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should not send notification if the user likes their own comment', async () => {
      // Arrange
      const ownComment = {
        ...mockComment,
        client: mockClient,
      } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      commentRepository.findOne.mockResolvedValueOnce(ownComment);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(null);

      // Act
      await service.like(clientId, commentId);

      // Assert
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should propagate error if repository findOne fails', async () => {
      // Arrange
      clientRepository.findOne.mockRejectedValueOnce(new Error('DB Error'));

      // Act & Assert
      await expect(service.like(clientId, commentId)).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
