import { Test, TestingModule } from '@nestjs/testing';
import { FirebaseService } from './Firebase.service';
import * as admin from 'firebase-admin';
import { SupportedLanguages } from 'enums/SupportedLanguages';
import { UserNotFoundException } from 'exceptions/UserNotFoundException';
import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('firebase-admin', () => {
  const authMock = {
    getUser: jest.fn(),
    verifyIdToken: jest.fn(),
    setCustomUserClaims: jest.fn(),
    deleteUser: jest.fn(),
    deleteUsers: jest.fn(),
  };
  const messagingMock = {
    send: jest.fn(),
  };
  return {
    auth: jest.fn(() => authMock),
    messaging: jest.fn(() => messagingMock),
  };
});

describe('FirebaseService', () => {
  let service: FirebaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FirebaseService],
    }).compile();

    service = module.get<FirebaseService>(FirebaseService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserFromUid', () => {
    it('should return user record when firebase auth resolves', async () => {
      // Given (Arrange)
      const mockUserRecord = { uid: 'user-123', email: 'test@example.com' };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);

      // When (Act)
      const result = await service.getUserFromUid('user-123');

      // Then (Assert)
      expect(admin.auth().getUser).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(mockUserRecord);
    });

    it('should throw UserNotFoundException when firebase auth rejects', async () => {
      // Given (Arrange)
      (admin.auth().getUser as jest.Mock).mockRejectedValueOnce(
        new Error('User not found'),
      );

      // When & Then (Act & Assert)
      await expect(service.getUserFromUid('invalid-uid')).rejects.toThrow(
        UserNotFoundException,
      );
    });
  });

  describe('getUserFromRequest', () => {
    it('should extract token and return user when firebasetoken header is present', async () => {
      // Given (Arrange)
      const req = {
        headers: {
          firebasetoken: 'valid-token-123',
        },
      } as any;
      const mockDecodedToken = { uid: 'user-123' };
      (admin.auth().verifyIdToken as jest.Mock).mockResolvedValueOnce(
        mockDecodedToken,
      );

      // When (Act)
      const result = await service.getUserFromRequest(req);

      // Then (Assert)
      expect(admin.auth().verifyIdToken).toHaveBeenCalledWith(
        'valid-token-123',
      );
      expect(result).toEqual(mockDecodedToken);
    });

    it('should throw UnauthorizedException when firebasetoken header is missing', async () => {
      // Given (Arrange)
      const req = { headers: {} } as any;

      // When & Then (Act & Assert)
      await expect(service.getUserFromRequest(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when firebasetoken header is empty', async () => {
      // Given (Arrange)
      const req = { headers: { firebasetoken: '' } } as any;

      // When & Then (Act & Assert)
      await expect(service.getUserFromRequest(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getUserFromToken', () => {
    it('should verify token successfully and return decoded token', async () => {
      // Given (Arrange)
      const mockDecodedToken = { uid: 'user-123', name: 'Test User' };
      (admin.auth().verifyIdToken as jest.Mock).mockResolvedValueOnce(
        mockDecodedToken,
      );

      // When (Act)
      const result = await service.getUserFromToken('valid-token');

      // Then (Assert)
      expect(admin.auth().verifyIdToken).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual(mockDecodedToken);
    });

    it('should throw UnauthorizedException when verifyIdToken fails', async () => {
      // Given (Arrange)
      (admin.auth().verifyIdToken as jest.Mock).mockRejectedValueOnce(
        new Error('Invalid token'),
      );

      // When & Then (Act & Assert)
      await expect(service.getUserFromToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getClaim', () => {
    it('should return claim value when customClaims.customClaims contains the key', async () => {
      // Given (Arrange)
      const mockUserRecord = {
        uid: 'user-1',
        customClaims: {
          customClaims: {
            isAdmin: true,
          },
        },
      };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);

      // When (Act)
      const result = await service.getClaim('user-1', 'isAdmin');

      // Then (Assert)
      expect(result).toBe(true);
    });

    it('should return claim value when customClaims directly contains the key', async () => {
      // Given (Arrange)
      const mockUserRecord = {
        uid: 'user-1',
        customClaims: {
          isArtist: true,
        },
      };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);

      // When (Act)
      const result = await service.getClaim('user-1', 'isArtist');

      // Then (Assert)
      expect(result).toBe(true);
    });

    it('should return false if customClaims does not contain the key', async () => {
      // Given (Arrange)
      const mockUserRecord = {
        uid: 'user-1',
        customClaims: {
          isArtist: true,
        },
      };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);

      // When (Act)
      const result = await service.getClaim('user-1', 'nonExistent');

      // Then (Assert)
      expect(result).toBe(false);
    });

    it('should return false if customClaims is undefined', async () => {
      // Given (Arrange)
      const mockUserRecord = {
        uid: 'user-1',
        customClaims: undefined,
      };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);

      // When (Act)
      const result = await service.getClaim('user-1', 'isAdmin');

      // Then (Assert)
      expect(result).toBe(false);
    });
  });

  describe('changeCustomClaims', () => {
    it('should update custom claims successfully when nested customClaims exist', async () => {
      // Given (Arrange)
      const mockUserRecord = {
        uid: 'user-1',
        customClaims: {
          customClaims: {
            existingClaim: 'value1',
          },
        },
      };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);
      (admin.auth().setCustomUserClaims as jest.Mock).mockResolvedValueOnce(
        undefined,
      );

      // When (Act)
      await service.changeCustomClaims('user-1', 'newKey', 'newValue');

      // Then (Assert)
      expect(admin.auth().setCustomUserClaims).toHaveBeenCalledWith('user-1', {
        customClaims: {
          existingClaim: 'value1',
          newKey: 'newValue',
        },
      });
    });

    it('should update custom claims successfully when direct customClaims exist', async () => {
      // Given (Arrange)
      const mockUserRecord = {
        uid: 'user-1',
        customClaims: {
          role: 'user',
        },
      };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);
      (admin.auth().setCustomUserClaims as jest.Mock).mockResolvedValueOnce(
        undefined,
      );

      // When (Act)
      await service.changeCustomClaims('user-1', 'role', 'admin');

      // Then (Assert)
      expect(admin.auth().setCustomUserClaims).toHaveBeenCalledWith('user-1', {
        customClaims: {
          role: 'admin',
        },
      });
    });

    it('should rethrow error when setCustomUserClaims fails', async () => {
      // Given (Arrange)
      const mockUserRecord = { uid: 'user-1', customClaims: {} };
      (admin.auth().getUser as jest.Mock).mockResolvedValueOnce(mockUserRecord);
      (admin.auth().setCustomUserClaims as jest.Mock).mockRejectedValueOnce(
        new Error('Claims error'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.changeCustomClaims('user-1', 'key', 'val'),
      ).rejects.toThrow('Claims error');
    });
  });

  describe('deleteUser', () => {
    it('should call admin.auth().deleteUser successfully', async () => {
      // Given (Arrange)
      (admin.auth().deleteUser as jest.Mock).mockResolvedValueOnce(undefined);

      // When (Act)
      const result = await service.deleteUser('user-to-delete');

      // Then (Assert)
      expect(admin.auth().deleteUser).toHaveBeenCalledWith('user-to-delete');
      expect(result).toBeUndefined();
    });

    it('should handle errors gracefully without throwing when deleteUser rejects', async () => {
      // Given (Arrange)
      (admin.auth().deleteUser as jest.Mock).mockRejectedValueOnce(
        new Error('Delete error'),
      );

      // When (Act)
      const result = await service.deleteUser('user-to-delete');

      // Then (Assert)
      expect(admin.auth().deleteUser).toHaveBeenCalledWith('user-to-delete');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteUserBatch', () => {
    it('should call admin.auth().deleteUsers successfully', async () => {
      // Given (Arrange)
      const batchResult = {
        successCount: 2,
        failureCount: 1,
        errors: [{ error: { toJSON: () => ({ message: 'failed' }) } }],
      };
      (admin.auth().deleteUsers as jest.Mock).mockResolvedValueOnce(
        batchResult,
      );

      // When (Act)
      const result = await service.deleteUserBatch(['user-1', 'user-2']);

      // Then (Assert)
      expect(admin.auth().deleteUsers).toHaveBeenCalledWith([
        'user-1',
        'user-2',
      ]);
      expect(result).toBeUndefined();
    });

    it('should handle errors gracefully without throwing when deleteUsers rejects', async () => {
      // Given (Arrange)
      (admin.auth().deleteUsers as jest.Mock).mockRejectedValueOnce(
        new Error('Batch error'),
      );

      // When (Act)
      const result = await service.deleteUserBatch(['user-1']);

      // Then (Assert)
      expect(admin.auth().deleteUsers).toHaveBeenCalledWith(['user-1']);
      expect(result).toBeUndefined();
    });
  });

  describe('toHumanLanguage', () => {
    it('should return english text when language is SupportedLanguages.ENGLISH', () => {
      // Given (Arrange)
      const translationObj = { en: 'Hello', pt: 'Olá' };

      // When (Act)
      const result = service.toHumanLanguage(
        translationObj,
        SupportedLanguages.ENGLISH,
      );

      // Then (Assert)
      expect(result).toBe('Hello');
    });

    it('should return portuguese text when language is SupportedLanguages.PORTUGUES', () => {
      // Given (Arrange)
      const translationObj = { en: 'Hello', pt: 'Olá' };

      // When (Act)
      const result = service.toHumanLanguage(
        translationObj,
        SupportedLanguages.PORTUGUES,
      );

      // Then (Assert)
      expect(result).toBe('Olá');
    });
  });

  describe('sendMessage', () => {
    it('should throw HttpException with NOT_FOUND status if token is null', async () => {
      // Given (Arrange)
      const messageObj: any = {
        id: 'msg-1',
        title: { en: 'T', pt: 'T' },
        message: { en: 'M', pt: 'M' },
      };

      // When & Then (Act & Assert)
      await expect(
        service.sendMessage(
          messageObj,
          null as any,
          SupportedLanguages.ENGLISH,
        ),
      ).rejects.toThrow(
        new HttpException('push token not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should send notification message with appUrl when appUrl is present', async () => {
      // Given (Arrange)
      const messageObj: any = {
        id: 'msg-1',
        title: { en: 'Title EN', pt: 'Titulo PT' },
        message: { en: 'Body EN', pt: 'Corpo PT' },
        appUrl: 'https://app.link',
      };
      (admin.messaging().send as jest.Mock).mockResolvedValueOnce(
        'msg-response-id',
      );

      // When (Act)
      await service.sendMessage(
        messageObj,
        'device-token',
        SupportedLanguages.ENGLISH,
      );

      // Then (Assert)
      expect(admin.messaging().send).toHaveBeenCalledWith({
        token: 'device-token',
        notification: {
          title: 'Title EN',
          body: 'Body EN',
        },
        data: {
          id: 'msg-1',
          appUrl: 'https://app.link',
        },
      });
    });

    it('should send notification message without appUrl when appUrl is not present', async () => {
      // Given (Arrange)
      const messageObj: any = {
        id: 'msg-2',
        title: { en: 'Title EN', pt: 'Titulo PT' },
        message: { en: 'Body EN', pt: 'Corpo PT' },
      };
      (admin.messaging().send as jest.Mock).mockResolvedValueOnce(
        'msg-response-id',
      );

      // When (Act)
      await service.sendMessage(
        messageObj,
        'device-token',
        SupportedLanguages.PORTUGUES,
      );

      // Then (Assert)
      expect(admin.messaging().send).toHaveBeenCalledWith({
        token: 'device-token',
        notification: {
          title: 'Titulo PT',
          body: 'Corpo PT',
        },
        data: {
          id: 'msg-2',
        },
      });
    });

    it('should handle errors gracefully without throwing when admin.messaging().send rejects', async () => {
      // Given (Arrange)
      const messageObj: any = {
        id: 'msg-3',
        title: { en: 'Title EN', pt: 'Titulo PT' },
        message: { en: 'Body EN', pt: 'Corpo PT' },
      };
      (admin.messaging().send as jest.Mock).mockRejectedValueOnce(
        new Error('Messaging error'),
      );

      // When (Act)
      const result = await service.sendMessage(
        messageObj,
        'device-token',
        SupportedLanguages.ENGLISH,
      );

      // Then (Assert)
      expect(result).toBeUndefined();
    });
  });
});
