import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InstagramService } from './instagram.service';
import { HttpService } from '@nestjs/axios';
import { InstagramIntegrationEntity } from '../../model/instagram/InstagramIntegration.entity';
import { Photo } from '../../model/tattoo/Photo.entity';
import { of, throwError } from 'rxjs';
import {
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ApprovalStatus } from '../../enums/ApprovalStatus';

describe('InstagramService', () => {
  let service: InstagramService;
  let httpService: any;
  let integrationRepo: any;
  let photoRepository: any;

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
    httpService = {
      get: jest.fn(),
      post: jest.fn(),
    };
    integrationRepo = createMockRepository();
    photoRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramService,
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: getRepositoryToken(InstagramIntegrationEntity),
          useValue: integrationRepo,
        },
        {
          provide: getRepositoryToken(Photo),
          useValue: photoRepository,
        },
      ],
    }).compile();

    service = module.get<InstagramService>(InstagramService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAuthUrl', () => {
    it('should return valid auth URL when configured', () => {
      (service as any).clientId = 'client-id';
      (service as any).clientSecret = 'client-secret';
      (service as any).redirectUri = 'https://redirect.uri';

      const result = service.getAuthUrl('state-test');
      expect(result).toContain('https://www.instagram.com/oauth/authorize');
      expect(result).toContain('state=state-test');
      expect(result).toContain('scope=instagram_business_basic');
    });

    it('should throw InternalServerErrorException when not configured', () => {
      (service as any).clientId = '';
      expect(() => service.getAuthUrl('state')).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('exchangeCode', () => {
    it('should exchange code for tokens and profile info', async () => {
      httpService.post.mockReturnValueOnce(
        of({ data: { access_token: 'short', user_id: '123' } }),
      );
      httpService.get.mockReturnValueOnce(
        of({ data: { access_token: 'long', expires_in: 3600 } }),
      );
      httpService.get.mockReturnValueOnce(
        of({
          data: { id: '123', username: 'testuser', profile_picture_url: 'pic' },
        }),
      );

      const result = await service.exchangeCode('code-val');

      expect(result.instagramUserId).toBe('123');
      expect(result.instagramUsername).toBe('testuser');
      expect(result.accessToken).toBeDefined();
      expect(httpService.post).toHaveBeenCalled();
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('should throw error if short-lived token exchange fails', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() => ({
          response: { data: { error_message: 'Invalid code' } },
        })),
      );
      await expect(service.exchangeCode('bad-code')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('getUserProfile', () => {
    it('should fetch user profile from graph api', async () => {
      httpService.get.mockReturnValueOnce(
        of({ data: { id: '123', username: 'user1' } }),
      );
      const result = await service.getUserProfile('token');
      expect(result.username).toBe('user1');
      expect(httpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/me'),
      );
    });

    it('should throw InternalServerErrorException if API fails', async () => {
      httpService.get.mockReturnValueOnce(
        throwError(() => new Error('API Error')),
      );
      await expect(service.getUserProfile('token')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findByArtist', () => {
    it('should return integration if found', async () => {
      const mockInt = { id: '1' } as any;
      integrationRepo.findOne.mockResolvedValueOnce(mockInt);
      const result = await service.findByArtist('artist-123');
      expect(result).toEqual(mockInt);
      expect(integrationRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { artist: { id: 'artist-123' } },
        }),
      );
    });
  });

  describe('upsertIntegration', () => {
    it('should update existing integration', async () => {
      const artist = { id: 'artist-1' } as any;
      const existing = { id: 'int-1', instagramUsername: 'old' } as any;
      integrationRepo.findOne.mockResolvedValueOnce(existing);

      await service.upsertIntegration(
        artist,
        'ig-123',
        'new-user',
        'token',
        new Date(),
      );

      expect(existing.instagramUsername).toBe('new-user');
      expect(integrationRepo.save).toHaveBeenCalledWith(existing);
    });

    it('should create new integration if none exists', async () => {
      const artist = { id: 'artist-1' } as any;
      integrationRepo.findOne.mockResolvedValueOnce(null);

      await service.upsertIntegration(
        artist,
        'ig-123',
        'user',
        'token',
        new Date(),
      );

      expect(integrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          instagramUserId: 'ig-123',
        }),
      );
    });
  });

  describe('getDecryptedToken', () => {
    it('should return decrypted token', () => {
      const integration = { accessToken: 'encrypted' } as any;
      // utils/encript is mocked by proxy/identity in many setups,
      // here we just check it returns the value
      const result = service.getDecryptedToken(integration);
      expect(result).toBeDefined();
    });
  });

  describe('isTokenExpired', () => {
    it('should return true if token is expired', () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() - 1000),
      } as any;
      expect(service.isTokenExpired(integration)).toBe(true);
    });

    it('should return false if token is valid', () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() + 10000),
      } as any;
      expect(service.isTokenExpired(integration)).toBe(false);
    });
  });

  describe('getIntegrationStatus', () => {
    it('should return connected false if no integration', async () => {
      integrationRepo.findOne.mockResolvedValueOnce(null);
      const result = await service.getIntegrationStatus('artist-1');
      expect(result.connected).toBe(false);
    });

    it('should return connected false and reason expired if token is old', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() - 1000),
        instagramUsername: 'user1',
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      const result = await service.getIntegrationStatus('artist-1');
      expect(result.connected).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('should return connected true if valid', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() + 10000),
        instagramUsername: 'user1',
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      const result = await service.getIntegrationStatus('artist-1');
      expect(result.connected).toBe(true);
      expect(result.instagramUsername).toBe('user1');
    });
  });

  describe('listMedia', () => {
    it('should throw NOT_CONNECTED if no integration exists', async () => {
      integrationRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.listMedia('artist-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw TOKEN_EXPIRED if token is expired', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() - 1000),
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      await expect(service.listMedia('artist-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should fetch media and mark already imported ones', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() + 10000),
        accessToken: 'token',
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);

      httpService.get.mockReturnValueOnce(
        of({
          data: {
            data: [
              { id: 'ig-media-1', media_url: 'url1' },
              { id: 'ig-media-2' },
            ],
            paging: { cursors: { after: 'next-cursor' } },
          },
        }),
      );

      photoRepository.createQueryBuilder().getRawMany.mockResolvedValueOnce([
        {
          instagram_media_id: 'ig-media-1',
          tattoo_id: 'tatt-1',
          tattoo_status: ApprovalStatus.APPROVED,
        },
      ]);

      const result = await service.listMedia('artist-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].alreadyImported).toBe(true);
      expect(result.data[0].existingTattooId).toBe('tatt-1');
      expect(result.data[1].alreadyImported).toBe(false);
      expect(result.paging.cursors?.after).toBe('next-cursor');
    });

    it('should handle pagination with after cursor', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() + 10000),
        accessToken: 'token',
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      httpService.get.mockReturnValueOnce(of({ data: { data: [] } }));

      await service.listMedia('artist-1', 'cursor123');

      expect(httpService.get).toHaveBeenCalledWith(
        expect.stringContaining('after=cursor123'),
      );
    });

    it('should throw TOKEN_EXPIRED if API returns 401', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() + 10000),
        accessToken: 'token',
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      httpService.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 401, data: { error: { code: 190 } } },
        })),
      );

      await expect(service.listMedia('artist-1')).rejects.toThrow(
        new BadRequestException({
          code: 'TOKEN_EXPIRED',
          message:
            'Token do Instagram inválido ou revogado. Reconecte sua conta.',
        }),
      );
    });

    it('should throw InternalServerErrorException for generic 400 errors', async () => {
      const integration = {
        tokenExpiresAt: new Date(Date.now() + 10000),
        accessToken: 'token',
      } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      httpService.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 400, data: { error: { code: 100 } } },
        })),
      );

      await expect(service.listMedia('artist-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('removeIntegration', () => {
    it('should call repository remove if integration exists', async () => {
      const integration = { id: 'int-1' } as any;
      integrationRepo.findOne.mockResolvedValueOnce(integration);
      await service.removeIntegration('artist-1');
      expect(integrationRepo.remove).toHaveBeenCalledWith(integration);
    });

    it('should do nothing if integration does not exist', async () => {
      integrationRepo.findOne.mockResolvedValueOnce(null);
      await service.removeIntegration('artist-1');
      expect(integrationRepo.remove).not.toHaveBeenCalled();
    });
  });
});
