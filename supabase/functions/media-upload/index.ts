import { authenticate, service, settings } from '../_shared/http.ts'
import { reserveUploadTicket } from '../_shared/upload-ticket.ts'
import { createMediaUploadHandler } from './handler.ts'
Deno.serve(createMediaUploadHandler({ authenticate, service, settings, reserveUploadTicket }))
