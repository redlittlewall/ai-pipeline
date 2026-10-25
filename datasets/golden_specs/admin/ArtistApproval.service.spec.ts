import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { InvalidParameterException } from 'exceptions/InvalidParameterException';
import { ArtistApprovalService } from './ArtistApproval.service';
import { Photo } from 'model/tattoo/Photo.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Avatar } from 'model/Avatar.entity';
import { Client } from 'model/users/Client.entity';
import { Admin } from 'model/users/Admin.entity';
import { Artist } from 'model/users/Artist.entity';
import { GetArtistAddressService } from 'modules/address/artist/GetArtistAddress.service';
import { ClientHashTagService } from 'modules/hashtags/ClientHashtag.service';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { AvatarService } from 'modules/avatar/AvatarService';
import { ApprovalStatus } from 'enums/ApprovalStatus';

describe('ArtistApprovalService', () => {
  let service: ArtistApprovalService;
  let photoRepository: any;
  let tattooRepository: any;
  let avatarRepository: any;
  let clientRepository: any;
  let adminRepository: any;
  let artistRepository: any;
  let getArtistAddressService: any;
  let clientHashTagService: any;
  let firebaseService: any;
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
              target[prop] = jest.fn().mockReturnValue(qb);
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
    const photoRepositoryQueryBuilder = createQueryBuilderMock();
    photoRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest
        .fn()
        .mockImplementation((e) =>
          Promise.resolve({ id: 'mock-id', ...(e || {}) }),
        ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(photoRepositoryQueryBuilder),
    };
    const tattooRepositoryQueryBuilder = createQueryBuilderMock();
    tattooRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest
        .fn()
        .mockImplementation((e) =>
          Promise.resolve({ id: 'mock-id', ...(e || {}) }),
        ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(tattooRepositoryQueryBuilder),
    };
    const avatarRepositoryQueryBuilder = createQueryBuilderMock();
    avatarRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest
        .fn()
        .mockImplementation((e) =>
          Promise.resolve({ id: 'mock-id', ...(e || {}) }),
        ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(avatarRepositoryQueryBuilder),
    };
    const clientRepositoryQueryBuilder = createQueryBuilderMock();
    clientRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest
        .fn()
        .mockImplementation((e) =>
          Promise.resolve({ id: 'mock-id', ...(e || {}) }),
        ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(clientRepositoryQueryBuilder),
    };
    const adminRepositoryQueryBuilder = createQueryBuilderMock();
    adminRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest
        .fn()
        .mockImplementation((e) =>
          Promise.resolve({ id: 'mock-id', ...(e || {}) }),
        ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(adminRepositoryQueryBuilder),
    };
    const artistRepositoryQueryBuilder = createQueryBuilderMock();
    artistRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      save: jest
        .fn()
        .mockImplementation((e) =>
          Promise.resolve({ id: 'mock-id', ...(e || {}) }),
        ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(artistRepositoryQueryBuilder),
    };
    getArtistAddressService = {
      get: jest.fn(),
    };
    clientHashTagService = {
      getClientTags: jest.fn(),
    };
    firebaseService = {
      changeCustomClaims: jest.fn(),
      getUserFromUid: jest.fn(),
    };
    notificationWorkflow = {
      call: jest.fn(),
    };
    avatarService = {
      getAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtistApprovalService,
        {
          provide: getRepositoryToken(Photo),
          useValue: photoRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Admin),
          useValue: adminRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: GetArtistAddressService,
          useValue: getArtistAddressService,
        },
        {
          provide: ClientHashTagService,
          useValue: clientHashTagService,
        },
        {
          provide: FirebaseService,
          useValue: firebaseService,
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

    service = module.get<ArtistApprovalService>(ArtistApprovalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getArtistsByFilter', () => {
    it('should throw InvalidParameterException when page is less than 0', async () => {
      await expect(service.getArtistsByFilter(-1, 10)).rejects.toThrow(
        InvalidParameterException,
      );
    });

    it('should throw InvalidParameterException when pageSize is less than 0', async () => {
      await expect(service.getArtistsByFilter(0, -1)).rejects.toThrow(
        InvalidParameterException,
      );
    });

    it('should execute getArtistsByFilter successfully with all filters', async () => {
      artistRepository.findAndCount.mockResolvedValue([
        [
          {
            id: 'artist-1',
            client: {
              username: 'john',
              description: 'desc',
              createdAt: new Date(),
            },
            status: ApprovalStatus.PENDING,
          },
        ],
        1,
      ]);

      const result = await service.getArtistsByFilter(
        0,
        10,
        'john',
        'Brazil',
        'SP',
        'Sao Paulo',
        ApprovalStatus.PENDING,
      );

      expect(result).toBeDefined();
      expect(result.total).toBe(1);
      expect(artistRepository.findAndCount).toHaveBeenCalled();
    });

    it('should execute getArtistsByFilter when status is TODOS and optional filters are omitted', async () => {
      artistRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getArtistsByFilter(
        0,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        'TODOS',
      );

      expect(result).toBeDefined();
      expect(result.total).toBe(0);
      expect(artistRepository.findAndCount).toHaveBeenCalled();
    });
  });

  describe('getArtistDataForAdmin', () => {
    it('should execute getArtistDataForAdmin successfully with firebase user', async () => {
      const mockArtist: any = {
        id: 'artist-id',
        client: {
          username: 'test-user',
          description: 'test-desc',
          createdAt: new Date(),
        },
        status: ApprovalStatus.PENDING,
      };

      firebaseService.getUserFromUid.mockResolvedValueOnce({
        email: 'test@example.com',
        emailVerified: true,
      });

      const result = await service.getArtistDataForAdmin(mockArtist);

      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
      expect(result.emailVerified).toBe(true);
    });

    it('should handle firebase error gracefully and return DTO', async () => {
      const mockArtist: any = {
        id: 'artist-id',
        client: {
          username: 'test-user',
          description: 'test-desc',
          createdAt: new Date(),
        },
        status: ApprovalStatus.PENDING,
      };

      firebaseService.getUserFromUid.mockRejectedValueOnce(
        new Error('Firebase error'),
      );

      const result = await service.getArtistDataForAdmin(mockArtist);

      expect(result).toBeDefined();
      expect(result.email).toBeUndefined();
    });
  });

  describe('changeStatus', () => {
    it('should throw UnauthorizedException when admin is not found', async () => {
      adminRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changeStatus(
          'admin-id',
          'artist-id',
          ApprovalStatus.APPROVED,
          'obs',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when admin client profile is not found', async () => {
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      clientRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changeStatus(
          'admin-id',
          'artist-id',
          ApprovalStatus.APPROVED,
          'obs',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when artist is not found', async () => {
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      clientRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      artistRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changeStatus(
          'admin-id',
          'artist-id',
          ApprovalStatus.APPROVED,
          'obs',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when artist address is null', async () => {
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      clientRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        address: null,
        client: { id: 'artist-id' } as any,
      } as any);

      await expect(
        service.changeStatus(
          'admin-id',
          'artist-id',
          ApprovalStatus.APPROVED,
          'obs',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should execute changeStatus successfully when status is APPROVED', async () => {
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      clientRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        address: {} as any,
        client: { id: 'artist-id' } as any,
        status: ApprovalStatus.PENDING,
      } as any);

      await service.changeStatus(
        'admin-id',
        'artist-id',
        ApprovalStatus.APPROVED,
        'approved obs',
      );

      expect(artistRepository.save).toHaveBeenCalled();
      expect(notificationWorkflow.call).toHaveBeenCalled();
    });

    it('should execute changeStatus successfully when status is BLOCKED', async () => {
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      clientRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        address: {} as any,
        client: { id: 'artist-id' } as any,
        status: ApprovalStatus.PENDING,
      } as any);

      await service.changeStatus(
        'admin-id',
        'artist-id',
        ApprovalStatus.BLOCKED,
        'blocked obs',
      );

      expect(artistRepository.save).toHaveBeenCalled();
      expect(notificationWorkflow.call).toHaveBeenCalled();
    });

    it('should execute changeStatus successfully when status is REPROVED', async () => {
      adminRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      clientRepository.findOne.mockResolvedValue({ id: 'admin-id' } as any);
      artistRepository.findOne.mockResolvedValue({
        id: 'artist-id',
        address: {} as any,
        client: { id: 'artist-id' } as any,
        status: ApprovalStatus.PENDING,
      } as any);

      await service.changeStatus(
        'admin-id',
        'artist-id',
        ApprovalStatus.REPROVED,
        'reproved obs',
      );

      expect(artistRepository.save).toHaveBeenCalled();
      expect(notificationWorkflow.call).toHaveBeenCalled();
    });
  });
});
