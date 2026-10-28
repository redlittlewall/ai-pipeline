import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetCommentService } from './GetComment.service';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Client } from 'model/users/Client.entity';
import { Comment } from 'model/comments/Comment.entity';
import { GetCommentDetailsDtoService } from './GetCommentDetailsDto.Service';
import { AvatarService } from 'modules/avatar/AvatarService';
import { GenericException } from 'exceptions/GenericException';
import { HttpStatus } from '@nestjs/common';

describe('GetCommentService', () => {
  let service: GetCommentService;
  let tattooEntityRepository: any;
  let clientRepository: any;
  let commentRepository: any;
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
    tattooEntityRepository = createMockRepository();
    clientRepository = createMockRepository();
    commentRepository = createMockRepository();
    getCommentDetailsDtoService = {
      getCommentDetails: jest.fn(),
    };
    avatarService = {
      getAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetCommentService,
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: commentRepository,
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

    service = module.get<GetCommentService>(GetCommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTattooComments', () => {
    it('should execute getTattooComments successfully (Happy Path)', async () => {
      // Arrange
      const clientId = 'client-1';
      const tattooId = 'tattoo-1';
      const mockTattoo = { id: tattooId };
      const mockClient = {
        id: clientId,
        username: 'testuser',
        badge: 'badge-1',
      };
      const mockComments = [{ id: 'comment-1' }, { id: 'comment-2' }];
      const mockAvatar = { url: 'avatar.png' };
      const mockCommentDetails = { id: 'comment-1', comment: 'test comment' };

      tattooEntityRepository.findOne.mockResolvedValueOnce(mockTattoo as any);
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      commentRepository.find.mockResolvedValueOnce(mockComments as any);
      avatarService.getAvatar.mockResolvedValueOnce(mockAvatar as any);
      getCommentDetailsDtoService.getCommentDetails.mockResolvedValue(
        mockCommentDetails as any,
      );

      // Act
      const result = await service.getTattooComments(clientId, tattooId, 1, 10);

      // Assert
      expect(tattooEntityRepository.findOne).toHaveBeenCalledWith({
        where: { id: tattooId },
      });
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: clientId },
        relations: ['badge'],
      });
      expect(commentRepository.find).toHaveBeenCalledWith({
        where: {
          tattoo: { id: tattooId },
          answerComment: expect.anything(),
        },
        order: {
          createdAt: 'DESC',
        },
        loadRelationIds: true,
        skip: 10,
        take: 10,
      });
      expect(avatarService.getAvatar).toHaveBeenCalledWith(clientId);
      expect(
        getCommentDetailsDtoService.getCommentDetails,
      ).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
      expect(result.client.id).toBe(clientId);
      expect(result.client.username).toBe('testuser');
      expect(result.comments).toHaveLength(2);
    });

    it('should use default page and pageSize parameters when not provided', async () => {
      // Arrange
      const clientId = 'client-1';
      const tattooId = 'tattoo-1';

      tattooEntityRepository.findOne.mockResolvedValueOnce({
        id: tattooId,
      } as any);
      clientRepository.findOne.mockResolvedValueOnce({
        id: clientId,
        username: 'user',
      } as any);
      commentRepository.find.mockResolvedValueOnce([] as any);
      avatarService.getAvatar.mockResolvedValueOnce(null as any);

      // Act
      const result = await service.getTattooComments(clientId, tattooId);

      // Assert
      expect(commentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toBeDefined();
      expect(result.comments).toEqual([]);
    });

    it('should throw GenericException with NOT_FOUND status when tattoo does not exist', async () => {
      // Arrange
      const clientId = 'client-1';
      const tattooId = 'non-existent-tattoo';

      tattooEntityRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockResolvedValueOnce({ id: clientId } as any);

      // Act & Assert
      await expect(
        service.getTattooComments(clientId, tattooId),
      ).rejects.toThrow(
        new GenericException(
          `photo ${tattooId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should throw GenericException with NOT_FOUND status when client does not exist', async () => {
      // Arrange
      const clientId = 'non-existent-client';
      const tattooId = 'tattoo-1';

      tattooEntityRepository.findOne.mockResolvedValueOnce({
        id: tattooId,
      } as any);
      clientRepository.findOne.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.getTattooComments(clientId, tattooId),
      ).rejects.toThrow(
        new GenericException(
          `client ${clientId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should handle empty comment list correctly', async () => {
      // Arrange
      const clientId = 'client-1';
      const tattooId = 'tattoo-1';

      tattooEntityRepository.findOne.mockResolvedValueOnce({
        id: tattooId,
      } as any);
      clientRepository.findOne.mockResolvedValueOnce({
        id: clientId,
        username: 'user',
      } as any);
      commentRepository.find.mockResolvedValueOnce([] as any);
      avatarService.getAvatar.mockResolvedValueOnce(null as any);

      // Act
      const result = await service.getTattooComments(clientId, tattooId, 0, 10);

      // Assert
      expect(result.comments).toHaveLength(0);
      expect(
        getCommentDetailsDtoService.getCommentDetails,
      ).not.toHaveBeenCalled();
    });
  });
});
