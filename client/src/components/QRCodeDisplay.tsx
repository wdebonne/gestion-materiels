import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'react-qr-code'
import { QrCode, Download, Printer } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import api from '@/lib/api'

interface QRCodeDisplayProps {
  objectId: number
  objectName: string
}

export default function QRCodeDisplay({ objectId, objectName }: QRCodeDisplayProps) {
  const [showModal, setShowModal] = useState(false)

  const { data } = useQuery({
    queryKey: ['qrcode', objectId],
    queryFn: async () => {
      const res = await api.get(`/qrcode/${objectId}`)
      return res.data.data
    },
    enabled: showModal
  })

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    
    const url = data?.url || `${window.location.origin}/objects/${objectId}`
    
    printWindow.document.write(`
      <html>
        <head>
          <title>QR Code - ${objectName}</title>
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; font-family: Arial, sans-serif; }
            .label { text-align: center; margin-top: 16px; }
            .name { font-size: 18px; font-weight: bold; }
            .ref { font-size: 12px; color: #666; margin-top: 4px; }
            @media print { body { padding: 20mm; } }
          </style>
        </head>
        <body>
          <div id="qr"></div>
          <div class="label">
            <div class="name">${objectName}</div>
          </div>
          <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"><\/script>
          <script>
            QRCode.toCanvas(document.createElement('canvas'), '${url}', { width: 200 }, function(err, canvas) {
              if (!err) document.getElementById('qr').appendChild(canvas);
              window.print();
              window.close();
            });
          <\/script>
        </body>
      </html>
    `)
  }

  const handleDownload = () => {
    const svg = document.getElementById('qr-svg-display')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    
    canvas.width = 300
    canvas.height = 300

    img.onload = () => {
      ctx?.drawImage(img, 0, 0)
      const link = document.createElement('a')
      link.download = `qrcode-${objectName.replace(/[^a-z0-9]/gi, '_')}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }

  const url = `${window.location.origin}/objects/${objectId}`

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setShowModal(true)}>
        <QrCode className="w-4 h-4 mr-1" />
        QR Code
      </Button>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="QR Code du matériel">
        <ModalBody>
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white p-4 rounded-lg border">
              <QRCode
                id="qr-svg-display"
                value={url}
                size={200}
                level="M"
              />
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900">{objectName}</p>
              <p className="text-xs text-gray-400 mt-1 break-all">{url}</p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-1" /> Télécharger
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-1" /> Imprimer
          </Button>
          <Button onClick={() => setShowModal(false)}>Fermer</Button>
        </ModalFooter>
      </Modal>
    </>
  )
}
