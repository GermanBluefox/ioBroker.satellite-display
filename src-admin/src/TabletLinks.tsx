// The links of the tablets in the settings (tab Tablets): one per tablet, as text and as a QR code, so a tablet only
// has to look at the screen. The adapter answers `tabletLinks` with the links of the running web app.
// "Pair a tablet" shows a one-time code instead (`tabletPairCode`): the ioBroker Visu app scans it and the tablet
// enters itself in the settings, with its name and screen size (lib/pairing.js). The adapter saves that itself, so the
// form open here learns it from the instance object and reloads.
import React from 'react';

import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    AddLink as IconPair,
    ContentCopy as IconCopy,
    QrCode2 as IconQr,
    Autorenew as IconRenew,
} from '@mui/icons-material';
import QRCode from 'react-qr-code';

import { I18n } from '@iobroker/gui-components';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

interface TabletLinksState extends ConfigGenericState {
    loading: boolean;
    links: { name: string; url: string }[] | null;
    error: string;
    /** The tablet whose new link waits for the confirmation */
    renew: string;
    /** The pairing code on screen */
    pairing: { url: string; expires: number; minutes: number } | null;
    /** The code on screen ran out */
    pairExpired: boolean;
    /** Name of the tablet that paired itself */
    paired: string;
}

/** @returns The names of the tablets in the settings of an instance object */
function tabletNames(obj: ioBroker.Object | null | undefined): Set<string> {
    const rows: unknown = (obj?.native as { tablets?: unknown } | undefined)?.tablets;
    const list = Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? Object.values(rows) : [];
    return new Set(
        list.map(row => String((row as { name?: unknown } | null)?.name ?? '').trim()).filter(name => !!name),
    );
}

class TabletLinks extends ConfigGeneric<ConfigGenericProps, TabletLinksState> {
    /** Tablets of the settings when the code was shown: a name that is not among them paired itself */
    private known = new Set<string>();

    /** The instance object while a pairing code is on screen */
    private watched = '';

    private expiryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            loading: false,
            links: null,
            error: '',
            renew: '',
            pairing: null,
            pairExpired: false,
            paired: '',
        };
    }

    componentWillUnmount(): void {
        this.stopPairing();
        super.componentWillUnmount();
    }

    /** A one-time code for "Pair a tablet"; the instance object tells when a tablet used it */
    async pair(): Promise<void> {
        const { adapterName, instance, socket } = this.props.oContext;
        const id = `system.adapter.${adapterName}.${instance}`;
        this.stopPairing();
        this.setState({ loading: true, error: '', paired: '', pairExpired: false, pairing: null });
        try {
            this.known = tabletNames(await socket.getObject(id));
            const answer = (await Promise.race([
                socket.sendTo(`${adapterName}.${instance}`, 'tabletPairCode', {}),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ])) as { url?: string; expires?: number; minutes?: number; error?: string } | undefined;
            if (!answer?.url) {
                this.setState({ loading: false, error: I18n.t('sd_links_not_running') });
                return;
            }
            const minutes = answer.minutes || 10;
            const expires = answer.expires || Date.now() + minutes * 60_000;
            this.watched = id;
            await socket.subscribeObject(id, this.onInstanceChange);
            this.expiryTimer = setTimeout(
                () => {
                    this.stopPairing();
                    this.setState({ pairing: null, pairExpired: true });
                },
                Math.max(0, expires - Date.now()),
            );
            this.setState({ loading: false, pairing: { url: answer.url, expires, minutes } });
        } catch {
            this.setState({ loading: false, error: I18n.t('sd_links_no_adapter') });
        }
    }

    /** The adapter saved its settings: a tablet that was not there before paired itself */
    onInstanceChange = (_id: string, obj: ioBroker.Object | null | undefined): void => {
        const name = [...tabletNames(obj)].find(n => !this.known.has(n));
        if (!name) {
            return;
        }
        this.stopPairing();
        this.setState({ pairing: null, paired: name });
        // the table of this form does not know the new row; without own changes the page shows it after a reload
        if (!this.props.changed) {
            setTimeout(() => window.location.reload(), 2500);
        }
    };

    stopPairing(): void {
        if (this.expiryTimer) {
            clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
        }
        if (this.watched) {
            void this.props.oContext.socket.unsubscribeObject(this.watched, this.onInstanceChange);
            this.watched = '';
        }
    }

    renderPairing(): React.JSX.Element | null {
        if (this.state.paired) {
            return (
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography
                        variant="body2"
                        color="success.main"
                        sx={{ flex: '1 1 300px' }}
                    >
                        {I18n.t(this.props.changed ? 'sd_pair_done_changed' : 'sd_pair_done', this.state.paired)}
                    </Typography>
                    {this.props.changed ? (
                        <Button
                            variant="outlined"
                            onClick={() => window.location.reload()}
                        >
                            {I18n.t('sd_pair_reload')}
                        </Button>
                    ) : null}
                </Box>
            );
        }
        if (this.state.pairExpired) {
            return (
                <Typography
                    variant="body2"
                    color="warning.main"
                >
                    {I18n.t('sd_pair_expired')}
                </Typography>
            );
        }
        const pairing = this.state.pairing;
        if (!pairing) {
            return null;
        }
        return (
            <Box
                sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    p: 2,
                    border: '1px solid',
                    borderColor: 'primary.main',
                    borderRadius: 1,
                }}
            >
                {/* white around the code: a camera reads it also on the dark theme */}
                <Box sx={{ background: '#fff', p: 2, lineHeight: 0 }}>
                    <QRCode
                        value={pairing.url}
                        size={196}
                    />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 300px' }}>
                    <Typography variant="subtitle1">{I18n.t('sd_pair')}</Typography>
                    <Typography variant="body2">{I18n.t('sd_pair_hint', pairing.minutes)}</Typography>
                    <Typography
                        variant="caption"
                        sx={{ wordBreak: 'break-all', userSelect: 'all', opacity: 0.7 }}
                    >
                        {pairing.url}
                    </Typography>
                    <Box>
                        <Button
                            size="small"
                            onClick={() => {
                                this.stopPairing();
                                this.setState({ pairing: null });
                            }}
                        >
                            {I18n.t('sd_cancel')}
                        </Button>
                    </Box>
                </Box>
            </Box>
        );
    }

    /** A new link for the tablet: the adapter replaces its key, the old link stops working at once */
    async renewKey(name: string): Promise<void> {
        const { adapterName, instance, socket } = this.props.oContext;
        this.setState({ renew: '', loading: true });
        try {
            const answer = (await Promise.race([
                socket.sendTo(`${adapterName}.${instance}`, 'tabletNewKey', { tablet: name }),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ])) as { link?: { name: string; url: string }; error?: string } | undefined;
            if (answer?.link) {
                const link = answer.link;
                this.setState(s => ({
                    loading: false,
                    error: '',
                    links: (s.links || []).map(l => (l.name === link.name ? link : l)),
                }));
            } else {
                this.setState({ loading: false, error: I18n.t('sd_links_not_running') });
            }
        } catch {
            this.setState({ loading: false, error: I18n.t('sd_links_no_adapter') });
        }
    }

    renderRenewDialog(): React.JSX.Element | null {
        const name = this.state.renew;
        if (!name) {
            return null;
        }
        return (
            <Dialog
                open
                onClose={() => this.setState({ renew: '' })}
            >
                <DialogTitle>{I18n.t('sd_links_renew_title', name)}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">{I18n.t('sd_links_renew_text')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => this.setState({ renew: '' })}>{I18n.t('sd_cancel')}</Button>
                    <Button
                        color="warning"
                        variant="contained"
                        onClick={() => void this.renewKey(name)}
                    >
                        {I18n.t('sd_links_renew')}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    async load(): Promise<void> {
        const { adapterName, instance, socket } = this.props.oContext;
        this.setState({ loading: true, error: '' });
        try {
            const answer = (await Promise.race([
                socket.sendTo(`${adapterName}.${instance}`, 'tabletLinks', {}),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ])) as { links?: { name: string; url: string }[]; error?: string } | undefined;
            if (answer?.error || !Array.isArray(answer?.links)) {
                this.setState({ loading: false, links: null, error: I18n.t('sd_links_not_running') });
            } else {
                this.setState({ loading: false, links: answer.links, error: '' });
            }
        } catch {
            this.setState({ loading: false, links: null, error: I18n.t('sd_links_no_adapter') });
        }
    }

    renderItem(): React.JSX.Element {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button
                        variant="outlined"
                        startIcon={<IconQr />}
                        disabled={this.state.loading || !this.props.alive}
                        onClick={() => void this.load()}
                    >
                        {I18n.t('sd_links_show')}
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<IconPair />}
                        disabled={this.state.loading || !this.props.alive}
                        onClick={() => void this.pair()}
                    >
                        {I18n.t('sd_pair')}
                    </Button>
                    <Typography
                        variant="body2"
                        sx={{ opacity: 0.7, flex: '1 1 300px' }}
                    >
                        {this.props.alive ? I18n.t('sd_links_hint') : I18n.t('sd_links_no_adapter')}
                    </Typography>
                </Box>
                {this.state.error ? (
                    <Typography
                        variant="body2"
                        color="warning.main"
                    >
                        {this.state.error}
                    </Typography>
                ) : null}
                {this.renderPairing()}
                {this.state.links?.length === 0 ? (
                    <Typography variant="body2">{I18n.t('sd_links_none')}</Typography>
                ) : null}
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(this.state.links || []).map(link => (
                        <Box
                            key={link.name}
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                                alignItems: 'center',
                                p: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                width: 260,
                            }}
                        >
                            <Typography variant="subtitle1">{link.name}</Typography>
                            {/* white around the code: a camera reads it also on the dark theme */}
                            <Box sx={{ background: '#fff', p: 2, lineHeight: 0 }}>
                                <QRCode
                                    value={link.url}
                                    size={196}
                                />
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                                <Typography
                                    variant="caption"
                                    sx={{ wordBreak: 'break-all', userSelect: 'all', flex: 1 }}
                                >
                                    {link.url}
                                </Typography>
                                <Tooltip title={I18n.t('sd_links_copy')}>
                                    <IconButton
                                        size="small"
                                        onClick={() => void navigator.clipboard?.writeText(link.url)}
                                    >
                                        <IconCopy fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                            <Button
                                size="small"
                                color="warning"
                                startIcon={<IconRenew />}
                                disabled={this.state.loading}
                                onClick={() => this.setState({ renew: link.name })}
                            >
                                {I18n.t('sd_links_renew')}
                            </Button>
                        </Box>
                    ))}
                </Box>
                {this.renderRenewDialog()}
            </Box>
        );
    }
}

export default TabletLinks;
