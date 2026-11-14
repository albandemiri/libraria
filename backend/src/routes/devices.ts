import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { listDevices, registerDevice, removeDevice } from '../drm/device.service';
import { InvalidDeviceKeyError, parseDevicePublicKey } from '../drm/licence-crypto';
import { authContext, requireAuth } from '../middleware/auth';

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

const registerSchema = z.object({
  platform: z.enum(['ios', 'android', 'desktop']),
  displayName: z.string().trim().min(1).max(60),
  // Length-capped first; the parser itself validates the DER before OpenSSL.
  publicKey: z
    .string()
    .max(256)
    .refine(
      (value) => {
        try {
          parseDevicePublicKey(value);
          return true;
        } catch (error) {
          if (error instanceof InvalidDeviceKeyError) return false;
          throw error;
        }
      },
      { message: 'Must be a base64url P-256 SPKI public key' },
    ),
});

const deviceParamSchema = z.object({ deviceId: z.string().uuid('Not a valid device id') });

devicesRouter.post('/', async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  const { device, created } = await registerDevice(authContext(req).userId, input);
  res.status(created ? 201 : 200).json({ device });
});

devicesRouter.get('/', async (req: Request, res: Response) => {
  res.json({ devices: await listDevices(authContext(req).userId) });
});

devicesRouter.delete('/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = deviceParamSchema.parse(req.params);
  await removeDevice(authContext(req).userId, deviceId, 'self');
  res.status(204).end();
});
