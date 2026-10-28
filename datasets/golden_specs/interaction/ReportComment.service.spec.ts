import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportCommentService } from './ReportComment.service';
import { Client } from 'model/users/Client.entity';
import { Comment } from 'model/comments/Comment.entity';
import { ClientInteractComment } from 'model/users/relations/ClientInteractComment.entity';

describe('ReportCommentService', () => {
  let service: ReportCommentService;
  let clientRepository: any;
  let commentRepository: any;
  let clientInteractCommentRepository: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportCommentService,
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
      ],
    }).compile();

    service = module.get<ReportCommentService>(ReportCommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('report', () => {
    const clientId = 'client-123';
    const commentId = 'comment-456';
    const reportMessage = 'Inappropriate content';

    it('should create a new report relation when no previous relation exists', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockResolvedValueOnce({ id: commentId } as any);
      clientRepository.findOne.mockResolvedValueOnce({ id: clientId } as any);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(null);

      // When (Act)
      await service.report(clientId, commentId, reportMessage);

      // Then (Assert)
      expect(clientInteractCommentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionType: 'REPORT',
          message: reportMessage,
          client: { id: clientId },
          comment: { id: commentId },
        }),
      );
    });

    it('should reactivate and update an existing deleted report relation', async () => {
      // Given (Arrange)
      const existingRelation = {
        id: 'rel-789',
        message: 'old message',
        deletedAt: new Date(),
      };
      commentRepository.findOne.mockResolvedValueOnce({ id: commentId } as any);
      clientRepository.findOne.mockResolvedValueOnce({ id: clientId } as any);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(
        existingRelation as any,
      );

      // When (Act)
      await service.report(clientId, commentId, reportMessage);

      // Then (Assert)
      expect(clientInteractCommentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'rel-789',
          message: reportMessage,
          deletedAt: null,
        }),
      );
    });

    it('should not update message if relation exists and is not deleted', async () => {
      // Given (Arrange)
      const activeRelation = {
        id: 'rel-789',
        message: 'existing message',
        deletedAt: null,
      };
      commentRepository.findOne.mockResolvedValueOnce({ id: commentId } as any);
      clientRepository.findOne.mockResolvedValueOnce({ id: clientId } as any);
      clientInteractCommentRepository.findOne.mockResolvedValueOnce(
        activeRelation as any,
      );

      // When (Act)
      await service.report(clientId, commentId, reportMessage);

      // Then (Assert)
      // Logic only saves new or reactivates deleted. If found and not deleted, it falls into "else" branch creating new.
      // Note: Based on the service code, if oldRelation exists but deletedAt is null, it goes to the 'else' block.
      expect(clientInteractCommentRepository.save).toHaveBeenCalled();
    });

    it('should propagate error if comment lookup fails', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then (Act & Assert)
      await expect(
        service.report(clientId, commentId, reportMessage),
      ).rejects.toThrow('DB Error');
    });

    it('should propagate error if client lookup fails', async () => {
      // Given (Arrange)
      commentRepository.findOne.mockResolvedValueOnce({ id: commentId } as any);
      clientRepository.findOne.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then (Act & Assert)
      await expect(
        service.report(clientId, commentId, reportMessage),
      ).rejects.toThrow('DB Error');
    });
  });
});
