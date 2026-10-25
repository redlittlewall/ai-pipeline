import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetHashtagsByStatusService } from './GetHashtagsByStatus.service';
import { Admin } from 'model/users/Admin.entity';
import { Client } from 'model/users/Client.entity';
import { Avatar } from 'model/Avatar.entity';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';
import { TattooHashtagsService } from 'modules/tattoo/hashtag/TattooHashtag.service';
import { AvatarService } from 'modules/avatar/AvatarService';
import { ClientService } from 'modules/users/Client.Service';
import { GetTattooPhotosService } from 'modules/tattoo/GetTattooPhotos.Service';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { UnauthorizedException } from '@nestjs/common';

describe('GetHashtagsByStatusService', () => {
  let service: GetHashtagsByStatusService;
  let adminRepository: any;
  let clientRepository: any;
  let avatarRepository: any;
  let hashtagRepository: any;
  let tattooHasHashtagRepository: any;
  let tattooHashtagsService: any;
  let avatarService: any;
  let clientService: any;
  let getTattooPhotosService: any;

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
    adminRepository = createMockRepository();
    clientRepository = createMockRepository();
    avatarRepository = createMockRepository();
    hashtagRepository = createMockRepository();
    tattooHasHashtagRepository = createMockRepository();
    tattooHashtagsService = {
      getTagsOfTattoo: jest.fn().mockResolvedValue([]),
    };
    avatarService = {
      getAvatar: jest.fn().mockResolvedValue(null),
    };
    clientService = {
      getClientDto: jest.fn().mockResolvedValue(null),
    };
    getTattooPhotosService = {
      getByTattooId: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetHashtagsByStatusService,
        {
          provide: getRepositoryToken(Admin),
          useValue: adminRepository,
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
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
        {
          provide: TattooHashtagsService,
          useValue: tattooHashtagsService,
        },
        {
          provide: AvatarService,
          useValue: avatarService,
        },
        {
          provide: ClientService,
          useValue: clientService,
        },
        {
          provide: GetTattooPhotosService,
          useValue: getTattooPhotosService,
        },
      ],
    }).compile();

    service = module.get<GetHashtagsByStatusService>(
      GetHashtagsByStatusService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should execute get successfully', async () => {
      // Given (Arrange)
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      hashtagRepository.find.mockResolvedValue([
        {
          id: 'hashtag-1',
          name: 'tattoo',
          status: ApprovalStatus.PENDING,
          createdBy: 'client-1',
        },
      ] as any);
      clientRepository.findOne.mockResolvedValue({
        id: 'client-1',
        username: 'john',
      } as any);
      tattooHasHashtagRepository.findOne.mockResolvedValue(null);

      // When (Act)
      const result = await service.get(
        'admin-id',
        'tattoo',
        ApprovalStatus.PENDING,
        0,
        10,
      );

      // Then (Assert)
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should throw UnauthorizedException when admin is not found (Negative Branch)', async () => {
      // Given (Arrange)
      adminRepository.findOne.mockResolvedValue(null);

      // When & Then (Act & Assert)
      await expect(
        service.get(
          'non-existent-admin',
          'tattoo',
          ApprovalStatus.PENDING,
          0,
          10,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return empty list when no hashtags are found', async () => {
      // Given (Arrange)
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      hashtagRepository.find.mockResolvedValue([]);

      // When (Act)
      const result = await service.get(
        'admin-id',
        'tattoo',
        ApprovalStatus.PENDING,
        0,
        10,
      );

      // Then (Assert)
      expect(result).toEqual([]);
    });

    it('should filter out orphan hashtags (where creator client does not exist)', async () => {
      // Given (Arrange)
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      hashtagRepository.find.mockResolvedValue([
        {
          id: 'hashtag-orphan',
          name: 'orphan',
          status: ApprovalStatus.PENDING,
          createdBy: 'deleted-user',
        },
      ] as any);
      clientRepository.findOne.mockResolvedValue(null);

      // When (Act)
      const result = await service.get(
        'admin-id',
        'orphan',
        ApprovalStatus.PENDING,
        0,
        10,
      );

      // Then (Assert)
      expect(result).toEqual([]);
    });
  });

  describe('getManageHashtagData', () => {
    it('should execute getManageHashtagData successfully', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValue({
        id: 'client-1',
        username: 'john',
      } as any);
      tattooHasHashtagRepository.findOne.mockResolvedValue({
        tattooDetails: {
          tattoo: {
            id: 'tattoo-1',
            status: ApprovalStatus.APPROVED,
            owner: { id: 'client-1' },
          },
        },
      } as any);

      // When (Act)
      const result = await service.getManageHashtagData('admin-id', {
        id: 'hashtag-1',
        name: 'tattoo',
        status: ApprovalStatus.PENDING,
        createdBy: 'client-1',
      } as any);

      // Then (Assert)
      expect(result).toBeDefined();
      expect(result.tattoo).not.toBeNull();
    });

    it('should return null if client is not found (Orphan Hashtag)', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValue(null);

      // When (Act)
      const result = await service.getManageHashtagData('admin-id', {
        id: 'hashtag-orphan',
        name: 'orphan',
        status: ApprovalStatus.PENDING,
        createdBy: 'non-existent',
      } as any);

      // Then (Assert)
      expect(result).toBeNull();
    });

    it('should handle hashtag without associated tattoo', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValue({
        id: 'client-1',
        username: 'john',
      } as any);
      tattooHasHashtagRepository.findOne.mockResolvedValue(null);

      // When (Act)
      const result = await service.getManageHashtagData('admin-id', {
        id: 'hashtag-1',
        name: 'tattoo',
        status: ApprovalStatus.PENDING,
        createdBy: 'client-1',
      } as any);

      // Then (Assert)
      expect(result).toBeDefined();
      expect(result.tattoo).toBeNull();
    });
  });
});
