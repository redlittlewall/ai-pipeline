import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import { InstagramImportService } from './instagram-import.service';
import { InstagramService } from './instagram.service';
import { MediaImageService } from '../media/services/media-image.service';
import { AwsS3Service } from '../media/aws-s3.service';
import { HttpService } from '@nestjs/axios';
import { SocketGateWay } from '../sockets/Socket.Gateway';
import { NotificationWorkflow } from '../notification/NotificationWorkflow.Service';
import { AiVisionService } from '../ai/AiVision.service';
import { AiCatalogService } from '../ai/AiCatalog.service';
import { ArtistPreferencesService } from '../profile/ArtistPreferences.service';
import { CreateTattooDetailsService } from '../tattoo/details/CreateTattooDetails.service';
import { DailyPostLimitService } from '../tattoo/daily-limit/DailyPostLimit.service';
import { TattooEntity } from '../../model/tattoo/Tattoo.entity';
import { Photo } from '../../model/tattoo/Photo.entity';
import { Media } from '../../model/media/Media.entity';
import { Client } from '../../model/users/Client.entity';
import { Artist } from '../../model/users/Artist.entity';
import { SocketsEntity } from '../../model/sockets/Sockets.entity';

describe('InstagramImportService', () => {
  let service: InstagramImportService;
  let instagramService: any;
  let mediaImageService: any;
  let awsS3Service: any;
  let httpService: any;
  let socketGateway: any;
  let notificationWorkflow: any;
  let aiVisionService: any;
  let aiCatalogService: any;
  let artistPreferencesService: any;
  let createTattooDetailsService: any;
  let dailyPostLimitService: any;
  let tattooRepository: any;
  let photoRepository: any;
  let mediaRepository: any;
  let clientRepository: any;
  let artistRepository: any;
  let socketRepository: any;

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
    instagramService = {
      findByArtist: jest.fn(),
      getDecryptedToken: jest.fn(),
      isTokenExpired: jest.fn(),
    };
    mediaImageService = {
      processImage: jest.fn(),
    };
    awsS3Service = {
      _getPresignedUrl: jest.fn(),
      uploadToS3: jest.fn(),
    };
    httpService = {
      get: jest.fn(),
    };
    socketGateway = {
      sendEvent: jest.fn(),
    };
    notificationWorkflow = {
      call: jest.fn(),
    };
    aiVisionService = {
      classifyTattoo: jest.fn(),
    };
    aiCatalogService = {
      resolveColorIds: jest.fn(),
      resolveStyleIds: jest.fn(),
    };
    artistPreferencesService = {
      findOrCreate: jest.fn(),
    };
    createTattooDetailsService = {
      create: jest.fn(),
    };
    dailyPostLimitService = {
      checkLimitOrThrow: jest.fn(),
      clearInFlight: jest.fn(),
      releaseInFlight: jest.fn(),
      reserveInFlight: jest.fn(),
    };
    tattooRepository = createMockRepository();
    photoRepository = createMockRepository();
    mediaRepository = createMockRepository();
    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    socketRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramImportService,
        {
          provide: InstagramService,
          useValue: instagramService,
        },
        {
          provide: MediaImageService,
          useValue: mediaImageService,
        },
        {
          provide: AwsS3Service,
          useValue: awsS3Service,
        },
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: SocketGateWay,
          useValue: socketGateway,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
        {
          provide: AiVisionService,
          useValue: aiVisionService,
        },
        {
          provide: AiCatalogService,
          useValue: aiCatalogService,
        },
        {
          provide: ArtistPreferencesService,
          useValue: artistPreferencesService,
        },
        {
          provide: CreateTattooDetailsService,
          useValue: createTattooDetailsService,
        },
        {
          provide: DailyPostLimitService,
          useValue: dailyPostLimitService,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: getRepositoryToken(Photo),
          useValue: photoRepository,
        },
        {
          provide: getRepositoryToken(Media),
          useValue: mediaRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(SocketsEntity),
          useValue: socketRepository,
        },
      ],
    }).compile();

    service = module.get<InstagramImportService>(InstagramImportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startImport', () => {
    const artistId = 'artist-123';
    const mediaIds = ['m1', 'm2'];

    it('should throw ConflictException if a job is already active for the artist', async () => {
      // Act 1: Start first job
      await service.startImport(artistId, mediaIds);

      // Act 2 & Assert: Try starting another immediately
      await expect(service.startImport(artistId, mediaIds)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should check daily limit and reserve in-flight quota', async () => {
      await service.startImport(artistId, mediaIds);

      expect(dailyPostLimitService.checkLimitOrThrow).toHaveBeenCalledWith(
        artistId,
        mediaIds.length,
      );
      expect(dailyPostLimitService.reserveInFlight).toHaveBeenCalledWith(
        artistId,
        mediaIds.length,
      );
    });

    it('should return jobId and total items when starting successfully', async () => {
      const result = await service.startImport(artistId, mediaIds);

      expect(result).toHaveProperty('jobId');
      expect(result.total).toBe(mediaIds.length);
    });

    it('should trigger processImport and handle completion in background', async () => {
      // Arrange
      instagramService.findByArtist.mockResolvedValue(null); // Early exit in processImport

      // Act
      await service.startImport(artistId, mediaIds);

      // Give event loop a tick to run background process
      await new Promise((resolve) => setImmediate(resolve));

      expect(dailyPostLimitService.clearInFlight).toHaveBeenCalledWith(
        artistId,
      );
    });
  });

  describe('processImport', () => {
    const artistId = 'artist-123';
    const mediaIds = ['m1'];
    const jobId = 'job-uuid';

    it('should stop and notify if instagram integration is missing', async () => {
      instagramService.findByArtist.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue({ id: artistId } as any);
      socketRepository.findOne.mockResolvedValue({
        socket: 'socket-id',
      } as any);

      // @ts-ignore - access private method for testing
      await service.processImport(jobId, artistId, mediaIds);

      expect(notificationWorkflow.call).toHaveBeenCalled();
      expect(socketGateway.sendEvent).toHaveBeenCalledWith(
        'socket-id',
        'importProgress',
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('não está conectada'),
        }),
      );
    });

    it('should skip already imported media using photoRepository queryBuilder', async () => {
      instagramService.findByArtist.mockResolvedValue({} as any);
      instagramService.isTokenExpired.mockReturnValue(false);
      instagramService.getDecryptedToken.mockReturnValue('token');
      clientRepository.findOne.mockResolvedValue({ id: artistId } as any);
      artistRepository.findOne.mockResolvedValue({ id: artistId } as any);
      artistPreferencesService.findOrCreate.mockResolvedValue({
        instagramAutoClassify: true,
        instagramSplitCarousels: false,
      } as any);
      socketRepository.findOne.mockResolvedValue({
        socket: 'socket-id',
      } as any);

      // Mock existing media
      photoRepository
        .createQueryBuilder()
        .getRawMany.mockResolvedValueOnce([{ instagram_media_id: 'm1' }]);

      // @ts-ignore
      await service.processImport(jobId, artistId, mediaIds);

      expect(dailyPostLimitService.releaseInFlight).toHaveBeenCalledWith(
        artistId,
        1,
      );
      expect(socketGateway.sendEvent).toHaveBeenCalledWith(
        'socket-id',
        'importProgress',
        expect.objectContaining({
          status: 'completed',
          total: 1,
        }),
      );
    });

    it('should process new IMAGE media and save to repository', async () => {
      instagramService.findByArtist.mockResolvedValue({} as any);
      instagramService.isTokenExpired.mockReturnValue(false);
      instagramService.getDecryptedToken.mockReturnValue('token');
      clientRepository.findOne.mockResolvedValue({ id: artistId } as any);
      artistRepository.findOne.mockResolvedValue({ id: artistId } as any);
      artistPreferencesService.findOrCreate.mockResolvedValue({} as any);
      photoRepository.createQueryBuilder().getRawMany.mockResolvedValueOnce([]);

      // Mock Graph API response
      httpService.get.mockReturnValueOnce(
        of({
          data: {
            id: 'm1',
            media_type: 'IMAGE',
            media_url: 'http://ig.com/p1.jpg',
            caption: 'test caption',
            timestamp: '2023-01-01T00:00:00Z',
          },
        }),
      );

      // Mock Image Download and Process
      httpService.get.mockReturnValueOnce(of({ data: Buffer.from('binary') }));
      mediaImageService.processImage.mockResolvedValue({
        buffer: Buffer.from('proc'),
      });

      // @ts-ignore
      await service.processImport(jobId, artistId, mediaIds);

      expect(tattooRepository.save).toHaveBeenCalled();
      expect(awsS3Service.uploadToS3).toHaveBeenCalled();
    });
  });

  describe('classifyAndFillTattoo', () => {
    const mockTattoo = { id: 't1' } as any;
    const mediaPath = 'path/to/img.jpg';

    it('should promote to PENDING and update details if IA classifies correctly', async () => {
      awsS3Service._getPresignedUrl.mockResolvedValue('http://s3.url');
      aiVisionService.classifyTattoo.mockResolvedValue({
        is_tattoo: true,
        isContentAppropriate: true,
        isSkinTattoo: true,
        bodyPartId: 'arm',
        sizeId: 'medium',
        description: 'AI description',
        styleIds: ['blackwork'],
      });

      // @ts-ignore
      const result = await service.classifyAndFillTattoo(
        mockTattoo,
        mediaPath,
        'Original',
      );

      expect(result).toBe('pending');
      expect(createTattooDetailsService.create).toHaveBeenCalled();
      expect(tattooRepository.update).toHaveBeenCalledWith(
        { id: mockTattoo.id },
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('should stay as DRAFT if IA identifies content as inappropriate', async () => {
      awsS3Service._getPresignedUrl.mockResolvedValue('http://s3.url');
      aiVisionService.classifyTattoo.mockResolvedValue({
        is_tattoo: true,
        isContentAppropriate: false,
        moderationReason: 'Policy violation',
      });

      // @ts-ignore
      const result = await service.classifyAndFillTattoo(mockTattoo, mediaPath);

      expect(result).toBe('draft');
      expect(tattooRepository.update).toHaveBeenCalledWith(
        { id: mockTattoo.id },
        expect.objectContaining({
          approvalComment: expect.stringContaining('Moderação IA'),
        }),
      );
    });

    it('should fallback to DRAFT if AI service fails', async () => {
      aiVisionService.classifyTattoo.mockRejectedValue(new Error('AI Down'));

      // @ts-ignore
      const result = await service.classifyAndFillTattoo(mockTattoo, mediaPath);

      expect(result).toBe('draft');
    });
  });
});
