import React, { useEffect, useRef, useState } from 'react';
import {
  getCachedAvatar,
  loadAndDecodeAvatar,
  preloadAvatarImage,
  subscribeAvatarCache,
} from '../lib/avatarCache.js';
import { getInitials } from '../lib/format.js';
import { prefersReducedMotion } from '../lib/morph.js';
import './ParticipantAvatars.css';

const CROSSFADE_DURATION_MS = 250;

function AvatarLayerContent({ image, initials }) {
  return image ? <img src={image} alt="" /> : initials;
}

export function ParticipantAvatar({ participant, className = '', useSelfEndpoint = false }) {
  const { user_id: userId, avatar_version: version, name, color } = participant || {};
  const initials = getInitials(name);
  const initialCached = userId && version ? getCachedAvatar(userId, version) : null;

  const [baseLayer, setBaseLayer] = useState(() => ({
    key: initialCached ? `${userId}:${version}` : `initials:${initials}`,
    image: initialCached,
    initials,
  }));
  const [incomingLayer, setIncomingLayer] = useState(null);

  const baseLayerRef = useRef(baseLayer);
  const incomingLayerRef = useRef(incomingLayer);
  const settleTimerRef = useRef(null);
  const rafRef = useRef(null);

  baseLayerRef.current = baseLayer;
  incomingLayerRef.current = incomingLayer;

  const clearTimers = () => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => () => clearTimers(), []);

  const commitImage = (nextImage, nextKey, nextInitials = initials) => {
    const currentVisible = incomingLayerRef.current || baseLayerRef.current;
    if (currentVisible.image === nextImage && currentVisible.initials === nextInitials) {
      return;
    }

    clearTimers();
    const nextLayer = {
      key: nextKey,
      image: nextImage,
      initials: nextInitials,
      visible: false,
    };

    if (prefersReducedMotion()) {
      setIncomingLayer(null);
      setBaseLayer({ key: nextKey, image: nextImage, initials: nextInitials });
      return;
    }

    setBaseLayer({
      key: currentVisible.key,
      image: currentVisible.image,
      initials: currentVisible.initials,
    });
    setIncomingLayer(nextLayer);

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setIncomingLayer((prev) => (prev && prev.key === nextKey ? { ...prev, visible: true } : prev));
    });

    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setBaseLayer({ key: nextKey, image: nextImage, initials: nextInitials });
      setIncomingLayer(null);
    }, CROSSFADE_DURATION_MS + 30);
  };

  useEffect(() => {
    if (!userId || !version) {
      commitImage(null, `initials:${initials}`, initials);
      return undefined;
    }

    const cachedImage = getCachedAvatar(userId, version);
    if (cachedImage) {
      let active = true;
      preloadAvatarImage(cachedImage).then(() => {
        if (active) commitImage(cachedImage, `${userId}:${version}`, initials);
      });
      return () => {
        active = false;
      };
    }

    let active = true;
    loadAndDecodeAvatar(userId, version, { useSelfEndpoint })
      .then((result) => {
        if (active && result) {
          commitImage(result, `${userId}:${version}`, initials);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [userId, version, initials, useSelfEndpoint]);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeAvatarCache(userId, (entry) => {
      if (!entry?.image || (version && entry.version !== version)) return;
      preloadAvatarImage(entry.image).then(() => {
        commitImage(entry.image, `${userId}:${entry.version}`, initials);
      });
    });
  }, [userId, version, initials]);

  return (
    <span
      className={`participant-avatar ${className}`.trim()}
      title={name}
      style={color ? { '--participant-color': color } : undefined}
    >
      <span className="participant-avatar__layer" key={baseLayer.key}>
        <AvatarLayerContent image={baseLayer.image} initials={baseLayer.initials} />
      </span>
      {incomingLayer && (
        <span
          className={`participant-avatar__layer participant-avatar__layer--entering${incomingLayer.visible ? ' is-visible' : ''}`}
          key={incomingLayer.key}
        >
          <AvatarLayerContent image={incomingLayer.image} initials={incomingLayer.initials} />
        </span>
      )}
    </span>
  );
}
export function ParticipantAvatars({ participants = [] }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current; if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const capacity = Math.max(1, Math.floor(Math.max(0, width - 32) / 26) + 1);
  const visibleCount = participants.length > capacity ? Math.max(0, capacity - 1) : participants.length;
  const hidden = participants.length - visibleCount;
  return <span className="events-home__avatars" ref={ref} aria-label={`${participants.length} participantes`}>
    {participants.slice(0, visibleCount).map(participant => <ParticipantAvatar key={participant.id} participant={participant} className="events-home__avatar" />)}
    {hidden > 0 && <span className="events-home__avatar events-home__avatar--more" title={`Mais ${hidden} participantes`}>+{hidden}</span>}
  </span>;
}
