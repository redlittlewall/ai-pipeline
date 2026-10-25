import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { PhotoNotFountException } from 'exceptions/PhotoNotFountException';
import { ChangeHashtagStatusService } from './ChangeHashtagStatus.service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { Admin } from 'model/users/Admin.entity';
import { Client } from 'model/users/Client.entity';

describe('ChangeHashtagStatusService', () => {
  let service: ChangeHashtagStatusService;
  let hashtagRepository: any;
  let adminRepository: any;
  let clientRepository: any;

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
    hashtagRepository = createMockRepository();
    adminRepository = createMockRepository();
    clientRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangeHashtagStatusService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
        {
          provide: getRepositoryToken(Admin),
          useValue: adminRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
      ],
    }).compile();

    service = module.get<ChangeHashtagStatusService>(
      ChangeHashtagStatusService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('changeMultipleHashtags', () => {
    it('should change status of multiple hashtags successfully', async () => {
      // Given (Arrange)
      const adminId = 'admin-1';
      const hashtagIds = ['hash-1', 'hash-2'];
      const status = ApprovalStatus.APPROVED;

      const mockAdmin = { id: adminId } as any;
      const mockClient = { id: adminId } as any;
      const mockHashtag1 = {
        id: 'hash-1',
        status: ApprovalStatus.PENDING,
      } as any;
      const mockHashtag2 = {
        id: 'hash-2',
        status: ApprovalStatus.PENDING,
      } as any;

      adminRepository.findOne.mockResolvedValue(mockAdmin);
      clientRepository.findOne.mockResolvedValue(mockClient);
      hashtagRepository.findOne
        .mockResolvedValueOnce(mockHashtag1)
        .mockResolvedValueOnce(mockHashtag2);

      // When (Act)
      const result = await service.changeMultipleHashtags(
        adminId,
        hashtagIds,
        status,
      );

      // Then (Assert)
      expect(result).toHaveLength(2);
      expect(hashtagRepository.save).toHaveBeenCalledTimes(2);
      expect(mockHashtag1.status).toBe(status);
      expect(mockHashtag1.approvedBy).toBe(mockClient);
      expect(mockHashtag2.status).toBe(status);
      expect(mockHashtag2.approvedBy).toBe(mockClient);
    });

    it('should return an empty array when hashtags list is empty', async () => {
      // Given (Arrange)
      const adminId = 'admin-1';
      const hashtags: string[] = [];

      // When (Act)
      const result = await service.changeMultipleHashtags(
        adminId,
        hashtags,
        ApprovalStatus.APPROVED,
      );

      // Then (Assert)
      expect(result).toEqual([]);
      expect(adminRepository.findOne).not.toHaveBeenCalled();
      expect(hashtagRepository.save).not.toHaveBeenCalled();
    });

    it('should propagate error when one hashtag update fails', async () => {
      // Given (Arrange)
      const adminId = 'admin-1';
      const hashtagIds = ['hash-1'];

      adminRepository.findOne.mockResolvedValue(null);

      // When & Then (Act & Assert)
      await expect(
        service.changeMultipleHashtags(
          adminId,
          hashtagIds,
          ApprovalStatus.APPROVED,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changeHashtag', () => {
    it('should update hashtag status and approvedBy successfully (Happy Path)', async () => {
      // Given (Arrange)
      const adminId = 'admin-123';
      const hashtagId = 'hashtag-456';
      const newStatus = ApprovalStatus.APPROVED;

      const mockAdmin = { id: adminId } as any;
      const mockClient = { id: adminId, name: 'Admin Client' } as any;
      const mockHashtag = {
        id: hashtagId,
        status: ApprovalStatus.PENDING,
        approvedBy: null,
      } as any;

      adminRepository.findOne.mockResolvedValueOnce(mockAdmin);
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      hashtagRepository.findOne.mockResolvedValueOnce(mockHashtag);

      // When (Act)
      const result = await service.changeHashtag(adminId, hashtagId, newStatus);

      // Then (Assert)
      expect(result).toBeUndefined();
      expect(adminRepository.findOne).toHaveBeenCalledWith({
        where: { id: adminId },
      });
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: adminId },
      });
      expect(hashtagRepository.findOne).toHaveBeenCalledWith({
        where: { id: hashtagId },
      });
      expect(mockHashtag.approvedBy).toBe(mockClient);
      expect(mockHashtag.status).toBe(newStatus);
      expect(hashtagRepository.save).toHaveBeenCalledWith(mockHashtag);
    });

    it('should throw UnauthorizedException when admin is not found', async () => {
      // Given (Arrange)
      const adminId = 'invalid-admin';
      const hashtagId = 'hashtag-456';

      adminRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      await expect(
        service.changeHashtag(adminId, hashtagId, ApprovalStatus.APPROVED),
      ).rejects.toThrow(new UnauthorizedException(`unauthorized not an admin`));
      expect(clientRepository.findOne).not.toHaveBeenCalled();
      expect(hashtagRepository.findOne).not.toHaveBeenCalled();
      expect(hashtagRepository.save).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when admin client profile is not found', async () => {
      // Given (Arrange)
      const adminId = 'admin-no-client';
      const hashtagId = 'hashtag-456';

      adminRepository.findOne.mockResolvedValueOnce({ id: adminId } as any);
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      await expect(
        service.changeHashtag(adminId, hashtagId, ApprovalStatus.APPROVED),
      ).rejects.toThrow(
        new UnauthorizedException(
          `admin ${adminId} has no client profile and cannot review`,
        ),
      );
      expect(hashtagRepository.findOne).not.toHaveBeenCalled();
      expect(hashtagRepository.save).not.toHaveBeenCalled();
    });

    it('should throw PhotoNotFountException when hashtag is not found', async () => {
      // Given (Arrange)
      const adminId = 'admin-123';
      const hashtagId = 'missing-hashtag';

      adminRepository.findOne.mockResolvedValueOnce({ id: adminId } as any);
      clientRepository.findOne.mockResolvedValueOnce({ id: adminId } as any);
      hashtagRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      await expect(
        service.changeHashtag(adminId, hashtagId, ApprovalStatus.APPROVED),
      ).rejects.toThrow(
        new PhotoNotFountException(`photo with id ${hashtagId} not found`),
      );
      expect(hashtagRepository.save).not.toHaveBeenCalled();
    });
  });
});
